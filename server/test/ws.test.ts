import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { attachWebSocketServer, TranscriptHub } from '../src/ws.js';
import { RegistryWatcher, type ProcessProbe } from '../src/registry.js';
import { AttachManager, type PtyLike } from '../src/attach.js';
import { composePaste } from '../src/paste.js';
import { decodeB64, encodeB64, type ServerFrame, type SessionInfo } from '../src/protocol.js';

const TOKEN = 'a'.repeat(32);
const SID = '49fbe6a0-0e11-45fc-b89d-82bad4ea0be5';

class FakePty implements PtyLike {
  writes: string[] = [];
  dataCb: ((d: string) => void) | null = null;
  onData(cb: (d: string) => void) { this.dataCb = cb; }
  onExit() {}
  write(d: string) { this.writes.push(d); }
  resize() {}
  kill() {}
}

const servers: Server[] = [];
afterEach(() => { for (const s of servers) s.close(); servers.length = 0; });

async function boot() {
  const cfg = mkdtempSync(join(tmpdir(), 'ccm-ws-'));
  const cwd = 'C:/Users/me/proj';
  mkdirSync(join(cfg, 'sessions'));
  mkdirSync(join(cfg, 'projects', 'C--Users-me-proj'), { recursive: true });
  const transcriptPath = join(cfg, 'projects', 'C--Users-me-proj', `${SID}.jsonl`);
  writeFileSync(transcriptPath, '');
  writeFileSync(join(cfg, 'sessions', '13804.json'), JSON.stringify({
    pid: 13804, sessionId: SID, cwd, startedAt: 1, kind: 'bg', jobId: '49fbe6a0', name: 'bg-one', status: 'idle',
  }));
  const probe: ProcessProbe = { probe: async () => ({ found: true, imageName: 'claude.exe' }) };
  const registry = new RegistryWatcher(join(cfg, 'sessions'), probe, 60_000);
  await registry.refresh();
  const ptys: FakePty[] = [];
  const attach = new AttachManager(() => { const p = new FakePty(); ptys.push(p); return p; }, { sleep: async () => {}, inputGraceMs: 0 });
  const transcripts = new TranscriptHub(cfg, 60_000);
  const hookBus = new EventEmitter();
  const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  attachWebSocketServer(server, { token: TOKEN, registry, attach, transcripts, hookBus });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  return { port, ptys, attach, hookBus, transcriptPath, registry, transcripts };
}

function connect(port: number, query: string, cookie = `ccm=${TOKEN}`) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`, { headers: cookie ? { cookie } : {} });
  const frames: ServerFrame[] = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  return { ws, frames };
}
const until = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

describe('WebSocket server', () => {
  it('rejects upgrades without a valid token', async () => {
    const { port } = await boot();
    const { ws } = connect(port, 'list=1', '');
    const err = await new Promise<Error>((r) => ws.on('error', r));
    expect(err.message).toContain('401');
  });

  it('sends the session list and pushes changes', async () => {
    const { port, registry } = await boot();
    const { ws, frames } = connect(port, 'list=1');
    await until(() => frames.some((f) => f.t === 'sessions'));
    const list = (frames[0] as { list: SessionInfo[] }).list;
    expect(list[0]).toMatchObject({ sessionId: SID, attachable: true, jobId: '49fbe6a0' });
    registry.emit('change', []);
    await until(() => frames.length >= 2);
    expect((frames[1] as { list: SessionInfo[] }).list).toEqual([]);
    ws.close();
  });

  it('attaches on the session page, relays output, input, paste and keys', async () => {
    const { port, ptys, attach } = await boot();
    const { ws, frames } = connect(port, `sid=${SID}`);
    await until(() => frames.some((f) => f.t === 'state'));
    expect(frames.find((f) => f.t === 'state')).toMatchObject({ attach: 'attached', status: 'idle', attachable: true });
    ptys[0].dataCb!('hi there');
    await until(() => frames.some((f) => f.t === 'out'));
    expect(decodeB64((frames.find((f) => f.t === 'out') as { d: string }).d)).toBe('hi there');
    ws.send(JSON.stringify({ t: 'in', d: encodeB64('x') }));
    ws.send(JSON.stringify({ t: 'key', name: 'esc' }));
    ws.send(JSON.stringify({ t: 'paste', text: '你好' }));
    await until(() => ptys[0].writes.length >= 4);
    expect(ptys[0].writes).toEqual(['x', '\x1b', composePaste('你好'), '\r']);
    ws.close();
    await until(() => attach.peek('49fbe6a0')!.clientCount() === 0);
  });

  it('forwards transcript messages and hook events for the session', async () => {
    const { port, transcriptPath, hookBus, transcripts } = await boot();
    const { ws, frames } = connect(port, `sid=${SID}`);
    await until(() => frames.some((f) => f.t === 'state'));
    appendFileSync(transcriptPath, JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-02T07:51:09.909Z', message: { role: 'user', content: '第一条' } }) + '\n');
    await (await transcripts.getTailer({ sessionId: SID, cwd: 'C:/Users/me/proj' } as SessionInfo)).poll();
    await until(() => frames.some((f) => f.t === 'chat'));
    expect((frames.find((f) => f.t === 'chat') as { messages: { text: string }[] }).messages[0].text).toBe('第一条');
    hookBus.emit('hook', { sessionId: SID, event: 'Stop', data: { stop_reason: 'end_turn' } });
    hookBus.emit('hook', { sessionId: 'other', event: 'Stop', data: {} });
    await until(() => frames.some((f) => f.t === 'hook'));
    expect(frames.filter((f) => f.t === 'hook').length).toBe(1);
    ws.close();
  });

  it('does not lose input frames sent immediately after the socket opens', async () => {
    const { port, ptys } = await boot();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${SID}`, { headers: { cookie: `ccm=${TOKEN}` } });
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'active' }));
      ws.send(JSON.stringify({ t: 'in', d: encodeB64('early') }));
    });
    await until(() => ptys.length > 0);
    ptys[0].dataCb!('screen'); // 有了第一段画面，输入闸门才会打开
    await until(() => ptys[0].writes.includes('early'));
    expect(ptys[0].writes).toContain('early');
    ws.close();
  });

  it('answers unknown sessions with an error frame', async () => {
    const { port } = await boot();
    const { ws, frames } = connect(port, 'sid=nope');
    await until(() => frames.some((f) => f.t === 'error'));
    expect((frames[0] as { message: string }).message).toContain('nope');
    ws.close();
  });
});

describe('TranscriptHub', () => {
  it('returns history for a session and shares one tailer', async () => {
    const { transcripts, transcriptPath } = await boot();
    const info = { sessionId: SID, cwd: 'C:/Users/me/proj' } as SessionInfo;
    appendFileSync(transcriptPath, JSON.stringify({ type: 'user', uuid: 'u9', timestamp: '2026-10-02T07:51:09.909Z', message: { role: 'user', content: '历史' } }) + '\n');
    const h = await transcripts.history(info, 10);
    expect(h.map((m) => m.text)).toEqual(['历史']);
    expect(await transcripts.getTailer(info)).toBe(await transcripts.getTailer(info));
    transcripts.stopAll();
  });
});
