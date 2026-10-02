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

interface HubEntry {
  tailer: TranscriptTailer | null;
  refs: number;
  starting: Promise<TranscriptTailer>;
  idleTimer: NodeJS.Timeout | null;
}

export class TranscriptHub {
  private tailers = new Map<string, HubEntry>();

  constructor(
    private readonly configDir: string,
    private readonly pollMs = 500,
    private readonly idleStopMs = 60_000,
  ) {}

  size(): number {
    return this.tailers.size;
  }

  getTailer(info: SessionInfo): Promise<TranscriptTailer> {
    let entry = this.tailers.get(info.sessionId);
    if (!entry) {
      // 先占位再做异步定位，并发调用共用同一个 starting，不会各建一个尾随器
      const e: HubEntry = { tailer: null, refs: 0, idleTimer: null, starting: Promise.resolve(null as unknown as TranscriptTailer) };
      e.starting = (async () => {
        const path = (await locateTranscript(this.configDir, info.cwd, info.sessionId))
          ?? defaultTranscriptPath(this.configDir, info.cwd, info.sessionId);
        const tailer = new TranscriptTailer(path, this.pollMs);
        await tailer.start();
        e.tailer = tailer;
        this.scheduleIdle(info.sessionId);
        return tailer;
      })();
      e.starting.catch(() => {
        if (this.tailers.get(info.sessionId) === e) this.tailers.delete(info.sessionId);
      });
      this.tailers.set(info.sessionId, e);
      entry = e;
    }
    return entry.starting;
  }

  async subscribe(info: SessionInfo, cb: (m: ChatMessage[]) => void): Promise<() => void> {
    const tailer = await this.getTailer(info);
    const entry = this.tailers.get(info.sessionId);
    if (!entry || entry.tailer !== tailer) return this.subscribe(info, cb); // 极少见：等待期间被回收，重来一次
    entry.refs += 1;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    tailer.on('messages', cb);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      tailer.off('messages', cb);
      entry.refs -= 1;
      if (entry.refs <= 0) this.scheduleIdle(info.sessionId);
    };
  }

  stats(sessionId: string): ParseStats {
    return this.tailers.get(sessionId)?.tailer?.stats ?? { unknown: 0, failed: 0 };
  }

  async history(info: SessionInfo, limit: number): Promise<ChatMessage[]> {
    return (await this.getTailer(info)).history(limit);
  }

  stopAll(): void {
    for (const e of this.tailers.values()) {
      if (e.idleTimer) clearTimeout(e.idleTimer);
      e.tailer?.stop();
    }
    this.tailers.clear();
  }

  // 没有订阅者的尾随器过一会儿就停掉，既回收资源，也让手机短暂重连时不必重读整个转录
  private scheduleIdle(sessionId: string): void {
    const entry = this.tailers.get(sessionId);
    if (!entry || entry.refs > 0) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const cur = this.tailers.get(sessionId);
      if (cur === entry && cur.refs <= 0) {
        cur.tailer?.stop();
        this.tailers.delete(sessionId);
      }
    }, this.idleStopMs);
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
  const initial = deps.registry.current().find((s) => s.sessionId === sid);
  if (!initial) {
    send(ws, { t: 'error', message: `找不到会话 ${sid}，它可能已经退出` });
    ws.close(4004);
    return;
  }
  const clientId = randomUUID();
  let session: AttachSession | null = null;
  let closed = false;
  let unsubscribeChat: (() => void) | null = null;
  let listening = false;

  const currentInfo = () => deps.registry.current().find((s) => s.sessionId === sid) ?? initial;

  const onHook = (ev: HookEvent) => {
    if (ev.sessionId === sid) send(ws, { t: 'hook', event: ev.event, data: ev.data });
  };
  // 注册表变化只通知本连接；状态值由 extras 实时查注册表，不依赖任何连接的闭包
  const onRegistryChange = () => {
    if (session) send(ws, session.stateFrame());
    else send(ws, readOnlyState(currentInfo(), deps));
  };

  // 关闭处理器必须在任何 await 之前挂上：客户端可能在准备期间就断开
  const cleanup = () => {
    if (closed) return;
    closed = true;
    session?.removeClient(clientId);
    unsubscribeChat?.();
    unsubscribeChat = null;
    if (listening) {
      deps.hookBus.off('hook', onHook);
      deps.registry.off('change', onRegistryChange);
      listening = false;
    }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  // 先挂上消息处理器再做任何异步准备：准备完成前到达的帧先排队，准备好后按顺序处理
  let ready = false;
  const pending: ClientFrame[] = [];
  const handle = (frame: ClientFrame) => {
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
  };
  ws.on('message', (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return;
    }
    if (!ready) pending.push(frame);
    else handle(frame);
  });

  const unsubscribe = await deps.transcripts.subscribe(initial, (messages) => send(ws, { t: 'chat', messages }));
  if (closed || ws.readyState !== WebSocket.OPEN) {
    unsubscribe();
    cleanup();
    return;
  }
  unsubscribeChat = unsubscribe;
  deps.hookBus.on('hook', onHook);
  deps.registry.on('change', onRegistryChange);
  listening = true;

  const info = currentInfo();
  if (info.attachable && info.jobId) {
    session = deps.attach.get(info.jobId, info.cwd);
    session.setStateExtras(() => ({
      status: deps.registry.current().find((s) => s.sessionId === sid)?.status ?? 'unknown',
      unknownRecords: deps.transcripts.stats(sid).unknown,
      attachable: true,
    }));
    const client: AttachClient = { id: clientId, cols: 80, rows: 24, send: (f) => send(ws, f) };
    session.addClient(client);
  } else {
    send(ws, readOnlyState(info, deps));
  }

  ready = true;
  for (const f of pending) handle(f);
  pending.length = 0;
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
