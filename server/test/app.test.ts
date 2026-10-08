import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { TranscriptHub } from '../src/ws.js';
import { RegistryWatcher, type ProcessProbe } from '../src/registry.js';
import { AttachManager, type PtyLike } from '../src/attach.js';
import type { ClaudeRunner } from '../src/control.js';

const TOKEN = 'b'.repeat(32);
const SID = '49fbe6a0-0e11-45fc-b89d-82bad4ea0be5';
const SID_RO = '64b4d103-5f51-4993-bdf5-10324f9dfefa';

class FakePty implements PtyLike {
  exitCb: ((e: { exitCode: number }) => void) | null = null;
  onData() {}
  onExit(cb: (e: { exitCode: number }) => void) { this.exitCb = cb; }
  write() {}
  resize() {}
  kill() {}
}

const servers: Server[] = [];
afterEach(() => { for (const s of servers) s.close(); servers.length = 0; });

async function boot(stopCode = 0) {
  const cfg = mkdtempSync(join(tmpdir(), 'ccm-app-'));
  mkdirSync(join(cfg, 'sessions'));
  mkdirSync(join(cfg, 'projects', 'C--Users-me-proj'), { recursive: true });
  writeFileSync(join(cfg, 'sessions', '13804.json'), JSON.stringify({
    pid: 13804, sessionId: SID, cwd: 'C:/Users/me/proj', startedAt: 2, kind: 'bg', jobId: '49fbe6a0', name: 'bg-one', status: 'idle',
  }));
  writeFileSync(join(cfg, 'sessions', '7288.json'), JSON.stringify({
    pid: 7288, sessionId: SID_RO, cwd: 'C:/Users/me/proj', startedAt: 1, kind: 'interactive', name: 'plain', status: 'idle',
  }));
  const probe: ProcessProbe = { probe: async () => ({ found: true, imageName: 'claude.exe' }) };
  const registry = new RegistryWatcher(join(cfg, 'sessions'), probe, 60_000);
  await registry.refresh();
  const ptys: FakePty[] = [];
  const attach = new AttachManager(() => { const p = new FakePty(); ptys.push(p); return p; }, { inputGraceMs: 0 });
  const transcripts = new TranscriptHub(cfg, 60_000, 200);
  const stopCalls: string[][] = [];
  const stopRunner: ClaudeRunner = async (args) => { stopCalls.push(args); return { code: stopCode, stdout: stopCode === 0 ? 'stopped 49fbe6a0' : 'boom' }; };
  const app = createApp({ token: TOKEN, registry, attach, transcripts, hookBus: new EventEmitter(), stopRunner });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const auth = { cookie: `ccm=${TOKEN}` };
  return { base, auth, stopCalls, attach, ptys, transcripts };
}

describe('HTTP app', () => {
  it('lists sessions for an authorized caller and rejects others', async () => {
    const { base, auth } = await boot();
    const ok = await fetch(`${base}/api/sessions`, { headers: auth });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { name: string }[]).map((s) => s.name).sort()).toEqual(['bg-one', 'plain']);
    expect((await fetch(`${base}/api/sessions`)).status).toBe(401);
  });

  it('stops a background session through claude stop and marks an attached session as stopped', async () => {
    const { base, auth, stopCalls, attach, ptys } = await boot();
    const session = attach.get('49fbe6a0', 'C:/Users/me/proj');
    session.addClient({ id: 'c', cols: 80, rows: 24, send: () => {} });
    const r = await fetch(`${base}/api/sessions/${SID}/stop`, { method: 'POST', headers: auth });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, output: 'stopped 49fbe6a0' });
    expect(stopCalls).toEqual([['stop', '49fbe6a0']]);
    ptys[0].exitCb!({ exitCode: 0 }); // 守护进程停掉会话后 attach 进程退出
    expect(session.state).toBe('detached');
    expect(session.reason).toBe('会话已停止');
  });

  it('answers 400 for a session that cannot be stopped, 404 for unknown ones, and 502 when claude fails', async () => {
    const { base, auth, stopCalls } = await boot();
    expect((await fetch(`${base}/api/sessions/${SID_RO}/stop`, { method: 'POST', headers: auth })).status).toBe(400);
    expect((await fetch(`${base}/api/sessions/nope/stop`, { method: 'POST', headers: auth })).status).toBe(404);
    expect(stopCalls).toEqual([]);
    const failing = await boot(1);
    const r = await fetch(`${failing.base}/api/sessions/${SID}/stop`, { method: 'POST', headers: failing.auth });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { output: string }).output).toContain('boom');
  });

  it('requires the token for stopping', async () => {
    const { base, stopCalls } = await boot();
    expect((await fetch(`${base}/api/sessions/${SID}/stop`, { method: 'POST' })).status).toBe(401);
    expect(stopCalls).toEqual([]);
  });
});
