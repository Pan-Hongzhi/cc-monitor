import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReconnectingSocket, wsUrl } from '../src/lib/ws';

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

beforeEach(() => { vi.useFakeTimers(); FakeWS.instances = []; });
afterEach(() => vi.useRealTimers());

describe('ReconnectingSocket', () => {
  it('delivers frames and reports status', () => {
    const s = new ReconnectingSocket('ws://x/ws?sid=1', { factory: (u) => new FakeWS(u) as unknown as WebSocket });
    const frames: unknown[] = [];
    const status: string[] = [];
    s.onFrame((f) => frames.push(f));
    s.onStatus((st) => status.push(st));
    s.connect();
    expect(status).toEqual(['connecting']);
    FakeWS.instances[0].open();
    FakeWS.instances[0].message({ t: 'out', d: 'aGk=' });
    expect(frames).toEqual([{ t: 'out', d: 'aGk=' }]);
    expect(status).toEqual(['connecting', 'open']);
  });
  it('drops sends while closed and sends while open', () => {
    const s = new ReconnectingSocket('ws://x/ws', { factory: (u) => new FakeWS(u) as unknown as WebSocket });
    s.connect();
    expect(s.send({ t: 'active' })).toBe(false);
    FakeWS.instances[0].open();
    expect(s.send({ t: 'active' })).toBe(true);
    expect(FakeWS.instances[0].sent).toEqual(['{"t":"active"}']);
  });
  it('reconnects with exponential backoff and stops after close()', async () => {
    const s = new ReconnectingSocket('ws://x/ws', { minDelay: 100, maxDelay: 400, factory: (u) => new FakeWS(u) as unknown as WebSocket });
    s.connect();
    FakeWS.instances[0].open();
    FakeWS.instances[0].close();
    await vi.advanceTimersByTimeAsync(99);
    expect(FakeWS.instances.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWS.instances.length).toBe(2);
    FakeWS.instances[1].close();
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeWS.instances.length).toBe(3);
    FakeWS.instances[2].close();
    await vi.advanceTimersByTimeAsync(400);
    expect(FakeWS.instances.length).toBe(4);
    FakeWS.instances[3].open();
    FakeWS.instances[3].close();
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWS.instances.length).toBe(5); // 成功打开后退避重置
    s.close();
    FakeWS.instances[4].close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWS.instances.length).toBe(5);
  });
});

describe('wsUrl', () => {
  it('derives ws scheme from location', () => {
    expect(wsUrl('/ws?sid=1', { protocol: 'http:', host: '192.168.1.5:8787' })).toBe('ws://192.168.1.5:8787/ws?sid=1');
    expect(wsUrl('/ws', { protocol: 'https:', host: 'h' })).toBe('wss://h/ws');
  });
});
