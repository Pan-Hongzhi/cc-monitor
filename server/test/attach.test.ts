import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AttachSession, AttachManager, TAKEOVER_MARKER, stripAnsi, type PtyLike, type PtyFactory } from '../src/attach.js';
import { composePaste } from '../src/paste.js';
import { decodeB64, type ServerFrame, type StateFrame } from '../src/protocol.js';

class FakePty implements PtyLike {
  writes: string[] = [];
  resizes: [number, number][] = [];
  killed = false;
  private dataCb: ((d: string) => void) | null = null;
  private exitCb: ((e: { exitCode: number }) => void) | null = null;
  onData(cb: (d: string) => void) { this.dataCb = cb; }
  onExit(cb: (e: { exitCode: number }) => void) { this.exitCb = cb; }
  write(d: string) { this.writes.push(d); }
  resize(c: number, r: number) { this.resizes.push([c, r]); }
  kill() { this.killed = true; }
  emit(d: string) { this.dataCb?.(d); }
  exit(code: number) { this.exitCb?.({ exitCode: code }); }
}

function harness() {
  const ptys: FakePty[] = [];
  const spawns: { jobId: string; cwd: string; cols: number; rows: number }[] = [];
  const factory: PtyFactory = (jobId, cwd, cols, rows) => {
    spawns.push({ jobId, cwd, cols, rows });
    const p = new FakePty();
    ptys.push(p);
    return p;
  };
  const s = new AttachSession({ jobId: '49fbe6a0', cwd: 'C:/p', factory, sleep: async () => {} });
  return { s, ptys, spawns, factory };
}

function client(id: string, cols: number, rows: number) {
  const frames: ServerFrame[] = [];
  return { c: { id, cols, rows, send: (f: ServerFrame) => frames.push(f) }, frames };
}
const states = (frames: ServerFrame[]) => frames.filter((f): f is StateFrame => f.t === 'state');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AttachSession', () => {
  it('spawns on first client with clamped size and reports attached', () => {
    const { s, spawns } = harness();
    const a = client('a', 40, 20);
    s.addClient(a.c);
    expect(spawns).toEqual([{ jobId: '49fbe6a0', cwd: 'C:/p', cols: 80, rows: 24 }]);
    expect(s.state).toBe('attached');
    const last = states(a.frames).at(-1)!;
    expect(last.attach).toBe('attached');
    expect(last.size).toEqual({ cols: 80, rows: 24 });
  });

  it('broadcasts output, buffers it, and replays to late clients', () => {
    const { s, ptys } = harness();
    const a = client('a', 120, 40);
    s.addClient(a.c);
    ptys[0].emit('hello ');
    ptys[0].emit('世界');
    expect(a.frames.filter((f) => f.t === 'out').map((f) => decodeB64((f as { d: string }).d))).toEqual(['hello ', '世界']);
    const b = client('b', 120, 40);
    s.addClient(b.c);
    const replay = b.frames.find((f) => f.t === 'replay') as { d: string };
    expect(decodeB64(replay.d)).toBe('hello 世界');
    expect(s.clientCount()).toBe(2);
  });

  it('writes input, maps keys, refuses ctrl-z, and pastes with CR', async () => {
    const { s, ptys } = harness();
    s.addClient(client('a', 120, 40).c);
    ptys[0].emit('screen');
    s.writeInput('x');
    s.sendKey('esc');
    s.sendKey('ctrl-z');
    await s.paste('你好\r\n世界');
    expect(ptys[0].writes).toEqual(['x', '\x1b', composePaste('你好\r\n世界'), '\r']);
  });

  it('holds input until the attach process has produced its first output, then flushes in order', () => {
    const { s, ptys } = harness();
    s.addClient(client('a', 120, 40).c);
    s.writeInput('early1');
    s.sendKey('esc');
    expect(ptys[0].writes).toEqual([]);
    ptys[0].emit('screen');
    expect(ptys[0].writes).toEqual(['early1', '']);
    s.writeInput('late');
    expect(ptys[0].writes).toEqual(['early1', '', 'late']);
  });

  it('follows the active client size with debounce and clamps small phones', async () => {
    const { s, ptys, spawns } = harness();
    const a = client('a', 120, 40);
    const b = client('b', 100, 30);
    s.addClient(a.c);
    expect(spawns[0]).toMatchObject({ cols: 120, rows: 40 });
    s.addClient(b.c);
    await vi.advanceTimersByTimeAsync(300);
    expect(ptys[0].resizes.at(-1)).toEqual([100, 30]);
    s.resizeClient('b', 40, 10);
    await vi.advanceTimersByTimeAsync(300);
    expect(ptys[0].resizes.at(-1)).toEqual([80, 24]);
    expect(s.size).toEqual({ cols: 80, rows: 24 });
    s.resizeClient('a', 90, 50); // a 不是 active，不生效
    await vi.advanceTimersByTimeAsync(300);
    expect(s.size).toEqual({ cols: 80, rows: 24 });
  });

  it('nudges the size after a late client joins so the TUI redraws', async () => {
    const { s, ptys } = harness();
    s.addClient(client('a', 120, 40).c);
    await vi.advanceTimersByTimeAsync(300);
    ptys[0].resizes.length = 0;
    const b = client('b', 120, 40);
    s.addClient(b.c);
    await vi.advanceTimersByTimeAsync(300);
    expect(ptys[0].resizes).toContainEqual([119, 40]);
    expect(ptys[0].resizes.at(-1)).toEqual([120, 40]);
  });

  it('detects takeover and can reattach', () => {
    const { s, ptys, spawns } = harness();
    const a = client('a', 120, 40);
    s.addClient(a.c);
    ptys[0].emit('\x1b[?1049l' + TAKEOVER_MARKER + ' ');
    ptys[0].exit(0);
    expect(s.state).toBe('taken_over');
    expect(states(a.frames).at(-1)!.reason).toContain('本地');
    s.reattach();
    expect(spawns.length).toBe(2);
    expect(s.state).toBe('attached');
  });

  it('reports unexpected exits as error with exit code and output tail', () => {
    const { s, ptys } = harness();
    const a = client('a', 120, 40);
    s.addClient(a.c);
    ptys[0].emit('\x1b[31mdaemon not running\x1b[0m');
    ptys[0].exit(1);
    expect(s.state).toBe('error');
    const reason = states(a.frames).at(-1)!.reason!;
    expect(reason).toContain('1');
    expect(reason).toContain('daemon not running');
    expect(reason).not.toContain('\x1b');
  });

  it('treats exit after detach() as a clean detach', () => {
    const { s, ptys } = harness();
    s.addClient(client('a', 120, 40).c);
    ptys[0].emit('screen');
    s.detach();
    expect(ptys[0].writes).toEqual(['\x1a']);
    ptys[0].exit(0);
    expect(s.state).toBe('detached');
    expect(s.reason).toBeUndefined();
  });

  it('detaches after the last client has been gone for the idle period, unless someone returns', async () => {
    const { s, ptys } = harness();
    s.addClient(client('a', 120, 40).c);
    ptys[0].emit('screen');
    s.removeClient('a');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ptys[0].writes).toEqual([]);
    s.addClient(client('b', 120, 40).c);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ptys[0].writes).toEqual([]);
    s.removeClient('b');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ptys[0].writes).toEqual(['\x1a']);
  });

  it('merges state extras into the state frame', () => {
    const { s } = harness();
    s.setStateExtras(() => ({ status: 'busy', unknownRecords: 3, attachable: true }));
    const a = client('a', 120, 40);
    s.addClient(a.c);
    expect(states(a.frames).at(-1)).toMatchObject({ status: 'busy', unknownRecords: 3, attach: 'attached' });
  });

  it('turns a factory failure into error state', () => {
    const s = new AttachSession({ jobId: 'x', cwd: 'C:/p', factory: () => { throw new Error('File not found'); } });
    const a = client('a', 120, 40);
    s.addClient(a.c);
    expect(s.state).toBe('error');
    expect(states(a.frames).at(-1)!.reason).toContain('File not found');
  });
});

describe('AttachManager', () => {
  it('returns one session per jobId', () => {
    const m = new AttachManager(() => new FakePty());
    const s1 = m.get('abc', 'C:/p');
    expect(m.get('abc', 'C:/p')).toBe(s1);
    expect(m.peek('nope')).toBeUndefined();
    m.disposeAll();
  });
});

describe('stripAnsi', () => {
  it('removes CSI and OSC sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m \x1b]0;title\x07done\x1b[?25l')).toBe('red done');
  });
});
