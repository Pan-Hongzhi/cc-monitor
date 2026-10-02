import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { isAuthorized } from './auth.js';
import type { AttachManager, AttachSession, AttachClient } from './attach.js';
import type { RegistryWatcher } from './registry.js';
import { TranscriptTailer, locateTranscript, defaultTranscriptPath, type ParseStats } from './transcript.js';
import { decodeB64, type ChatMessage, type ClientFrame, type ServerFrame, type SessionInfo, type StateFrame } from './protocol.js';
import type { HookEvent } from './hooks.js';

export class TranscriptHub {
  private tailers = new Map<string, { tailer: TranscriptTailer; refs: number; starting: Promise<void> }>();

  constructor(private readonly configDir: string, private readonly pollMs = 500) {}

  async getTailer(info: SessionInfo): Promise<TranscriptTailer> {
    let entry = this.tailers.get(info.sessionId);
    if (!entry) {
      const path = (await locateTranscript(this.configDir, info.cwd, info.sessionId))
        ?? defaultTranscriptPath(this.configDir, info.cwd, info.sessionId);
      const tailer = new TranscriptTailer(path, this.pollMs);
      entry = { tailer, refs: 0, starting: tailer.start() };
      this.tailers.set(info.sessionId, entry);
    }
    await entry.starting;
    return entry.tailer;
  }

  async subscribe(info: SessionInfo, cb: (m: ChatMessage[]) => void): Promise<() => void> {
    const tailer = await this.getTailer(info);
    const entry = this.tailers.get(info.sessionId)!;
    entry.refs += 1;
    tailer.on('messages', cb);
    return () => {
      tailer.off('messages', cb);
      entry.refs -= 1;
      if (entry.refs <= 0) {
        tailer.stop();
        this.tailers.delete(info.sessionId);
      }
    };
  }

  stats(sessionId: string): ParseStats {
    return this.tailers.get(sessionId)?.tailer.stats ?? { unknown: 0, failed: 0 };
  }

  async history(info: SessionInfo, limit: number): Promise<ChatMessage[]> {
    return (await this.getTailer(info)).history(limit);
  }

  stopAll(): void {
    for (const e of this.tailers.values()) e.tailer.stop();
    this.tailers.clear();
  }
}

export interface WsDeps {
  token: string;
  registry: RegistryWatcher;
  attach: AttachManager;
  transcripts: TranscriptHub;
  hookBus: EventEmitter;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

export function attachWebSocketServer(server: HttpServer, deps: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isAuthorized(req, deps.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.searchParams.get('list') === '1') return handleList(ws, deps);
    const sid = url.searchParams.get('sid');
    if (!sid) {
      send(ws, { t: 'error', message: '缺少 sid 参数' });
      ws.close(4000);
      return;
    }
    void handleSession(ws, sid, deps);
  });

  return wss;
}

function handleList(ws: WebSocket, deps: WsDeps): void {
  const push = (list: SessionInfo[]) => send(ws, { t: 'sessions', list });
  push(deps.registry.current());
  deps.registry.on('change', push);
  ws.on('close', () => deps.registry.off('change', push));
}

async function handleSession(ws: WebSocket, sid: string, deps: WsDeps): Promise<void> {
  let info = deps.registry.current().find((s) => s.sessionId === sid);
  if (!info) {
    send(ws, { t: 'error', message: `找不到会话 ${sid}，它可能已经退出` });
    ws.close(4004);
    return;
  }
  const clientId = randomUUID();
  let session: AttachSession | null = null;

  const unsubscribeChat = await deps.transcripts.subscribe(info, (messages) => send(ws, { t: 'chat', messages }));

  const onHook = (ev: HookEvent) => {
    if (ev.sessionId === sid) send(ws, { t: 'hook', event: ev.event, data: ev.data });
  };
  deps.hookBus.on('hook', onHook);

  const onRegistryChange = (list: SessionInfo[]) => {
    const next = list.find((s) => s.sessionId === sid);
    if (next) info = next;
    if (session) session.broadcastState();
    else send(ws, readOnlyState(info!, deps));
  };
  deps.registry.on('change', onRegistryChange);

  if (info.attachable && info.jobId) {
    session = deps.attach.get(info.jobId, info.cwd);
    session.setStateExtras(() => ({
      status: info!.status,
      unknownRecords: deps.transcripts.stats(sid).unknown,
      attachable: true,
    }));
    const client: AttachClient = { id: clientId, cols: 80, rows: 24, send: (f) => send(ws, f) };
    session.addClient(client);
  } else {
    send(ws, readOnlyState(info, deps));
  }

  ws.on('message', (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return;
    }
    if (!session) return;
    switch (frame.t) {
      case 'in': session.writeInput(decodeB64(frame.d)); break;
      case 'paste': void session.paste(frame.text); break;
      case 'key': session.sendKey(frame.name); break;
      case 'resize': session.resizeClient(clientId, frame.cols, frame.rows); break;
      case 'active': session.setActive(clientId); break;
      case 'attach': session.reattach(); break;
      default: break;
    }
  });

  ws.on('close', () => {
    session?.removeClient(clientId);
    unsubscribeChat();
    deps.hookBus.off('hook', onHook);
    deps.registry.off('change', onRegistryChange);
  });
}

function readOnlyState(info: SessionInfo, deps: WsDeps): StateFrame {
  return {
    t: 'state',
    attach: 'detached',
    reason: info.attachable ? undefined : '这个会话不是用 claude --bg 启动的，只能查看，不能输入',
    status: info.status,
    size: { cols: 80, rows: 24 },
    unknownRecords: deps.transcripts.stats(info.sessionId).unknown,
    attachable: info.attachable,
  };
}
