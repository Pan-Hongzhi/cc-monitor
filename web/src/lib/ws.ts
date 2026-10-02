import type { ClientFrame, ServerFrame } from './protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export function wsUrl(path: string, loc: { protocol: string; host: string } = window.location): string {
  return (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + path;
}

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private frameHandlers: ((f: ServerFrame) => void)[] = [];
  private statusHandlers: ((s: SocketStatus) => void)[] = [];
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly minDelay: number;
  private readonly maxDelay: number;
  private readonly factory: (url: string) => WebSocket;

  constructor(private readonly url: string, opts: { minDelay?: number; maxDelay?: number; factory?: (url: string) => WebSocket } = {}) {
    this.minDelay = opts.minDelay ?? 500;
    this.maxDelay = opts.maxDelay ?? 10_000;
    this.factory = opts.factory ?? ((u) => new WebSocket(u));
  }

  onFrame(h: (f: ServerFrame) => void): void { this.frameHandlers.push(h); }
  onStatus(h: (s: SocketStatus) => void): void { this.statusHandlers.push(h); }

  connect(): void {
    if (this.stopped) return;
    this.emitStatus('connecting');
    const ws = this.factory(this.url);
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.emitStatus('open'); };
    ws.onmessage = (e) => {
      let frame: ServerFrame;
      try { frame = JSON.parse(String(e.data)) as ServerFrame; } catch { return; }
      for (const h of this.frameHandlers) h(frame);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.emitStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose 会跟着触发 */ };
  }

  send(frame: ClientFrame): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(this.maxDelay, this.minDelay * 2 ** this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, delay);
  }

  private emitStatus(s: SocketStatus): void {
    for (const h of this.statusHandlers) h(s);
  }
}
