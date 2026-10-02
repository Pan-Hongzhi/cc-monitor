import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { encodeB64, type AttachState, type ServerFrame, type StateFrame } from './protocol.js';
import { RingBuffer } from './ringbuffer.js';
import { keyToSequence, sendPaste } from './paste.js';

const require = createRequire(import.meta.url);

export interface PtyLike {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type PtyFactory = (jobId: string, cwd: string, cols: number, rows: number) => PtyLike;

export interface AttachClient {
  id: string;
  cols: number;
  rows: number;
  send(frame: ServerFrame): void;
}

export type StateExtras = Pick<StateFrame, 'status' | 'unknownRecords' | 'attachable'>;

export interface AttachOptions {
  jobId: string;
  cwd: string;
  factory: PtyFactory;
  minCols?: number;
  minRows?: number;
  bufferChars?: number;
  idleDetachMs?: number;
  nudgeDelayMs?: number;
  resizeDebounceMs?: number;
  /** attach 进程产出第一段画面后再等多久才开始转发输入；实测它启动约 1 秒内会丢弃按键 */
  inputGraceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const TAKEOVER_MARKER = 'Session opened in another window';
const CTRL_Z = '\x1a';
const PENDING_INPUT_MAX = 64 * 1024;

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[A-Za-z~]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>]/g, '');
}

export class AttachSession extends EventEmitter {
  readonly jobId: string;
  state: AttachState = 'detached';
  reason?: string;
  size: { cols: number; rows: number };

  private readonly cwd: string;
  private readonly factory: PtyFactory;
  private readonly minCols: number;
  private readonly minRows: number;
  private readonly idleDetachMs: number;
  private readonly nudgeDelayMs: number;
  private readonly resizeDebounceMs: number;
  private readonly inputGraceMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly buffer: RingBuffer;
  private pty: PtyLike | null = null;
  private clients = new Map<string, AttachClient>();
  private activeId: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private resizeTimer: NodeJS.Timeout | null = null;
  private nudgeTimer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private requestedDetach = false;
  // attach 进程刚启动时会丢弃收到的按键：第一段画面出来之后再等 inputGraceMs，期间的输入先攒着
  private inputReady = false;
  private seenOutput = false;
  private pendingInput: string[] = [];
  private pendingInputChars = 0;
  private extras: () => StateExtras = () => ({ status: 'unknown', unknownRecords: 0, attachable: true });

  constructor(opts: AttachOptions) {
    super();
    this.jobId = opts.jobId;
    this.cwd = opts.cwd;
    this.factory = opts.factory;
    this.minCols = opts.minCols ?? 80;
    this.minRows = opts.minRows ?? 24;
    this.idleDetachMs = opts.idleDetachMs ?? 10 * 60_000;
    this.nudgeDelayMs = opts.nudgeDelayMs ?? 100;
    this.resizeDebounceMs = opts.resizeDebounceMs ?? 200;
    this.inputGraceMs = opts.inputGraceMs ?? 1500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.buffer = new RingBuffer(opts.bufferChars ?? 512 * 1024);
    this.size = { cols: this.minCols, rows: this.minRows };
  }

  setStateExtras(fn: () => StateExtras): void {
    this.extras = fn;
  }

  clientCount(): number {
    return this.clients.size;
  }

  stateFrame(): StateFrame {
    return { t: 'state', attach: this.state, reason: this.reason, size: { ...this.size }, ...this.extras() };
  }

  broadcastState(): void {
    const frame = this.stateFrame();
    for (const c of this.clients.values()) c.send(frame);
    this.emit('state', frame);
  }

  addClient(c: AttachClient): void {
    this.clients.set(c.id, c);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // 新客户端不抢尺寸：只有没有跟随对象时才接管，否则等它自己发 active/resize
    if (this.activeId === null || !this.clients.has(this.activeId)) this.activeId = c.id;
    if (this.state === 'attached') {
      c.send({ t: 'replay', d: encodeB64(this.buffer.toString()) });
      this.scheduleResize();
      this.scheduleNudge();
      c.send(this.stateFrame());
      return;
    }
    if (this.state === 'taken_over') {
      // 用户在本地明确接管了；新连接（包括手机自动重连）只报告状态，由用户点"接管回来"再抢回
      c.send(this.stateFrame());
      return;
    }
    this.spawn();
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    if (this.activeId === id) {
      const rest = [...this.clients.keys()];
      this.activeId = rest.length ? rest[rest.length - 1] : null;
      if (this.activeId) this.scheduleResize();
    }
    if (this.clients.size === 0 && this.state === 'attached') {
      this.idleTimer = setTimeout(() => this.detach(), this.idleDetachMs);
    }
  }

  setActive(id: string): void {
    if (!this.clients.has(id)) return;
    this.activeId = id;
    this.scheduleResize();
  }

  resizeClient(id: string, cols: number, rows: number): void {
    const c = this.clients.get(id);
    if (!c) return;
    c.cols = cols;
    c.rows = rows;
    if (this.activeId === id) this.scheduleResize();
  }

  writeInput(raw: string): void {
    if (this.state !== 'attached' || !this.pty) return;
    // Ctrl+Z 会让 attach 进程脱离并把监测器踢下线，客户端的原始按键里一律过滤掉
    const d = raw.includes(CTRL_Z) ? raw.split(CTRL_Z).join('') : raw;
    if (d.length === 0) return;
    if (!this.inputReady) {
      if (this.pendingInputChars + d.length > PENDING_INPUT_MAX) return;
      this.pendingInput.push(d);
      this.pendingInputChars += d.length;
      return;
    }
    this.pty.write(d);
  }

  sendKey(name: string): void {
    const seq = keyToSequence(name);
    if (seq) this.writeInput(seq);
  }

  paste(text: string): Promise<void> {
    return sendPaste((d) => this.writeInput(d), text, 50, this.sleep);
  }

  reattach(): void {
    if (this.state === 'attached' || this.state === 'attaching') return;
    this.spawn();
  }

  detach(): void {
    if (this.state !== 'attached' || !this.pty) return;
    this.requestedDetach = true;
    this.pty.write(CTRL_Z);
  }

  dispose(): void {
    for (const t of [this.idleTimer, this.resizeTimer, this.nudgeTimer, this.graceTimer]) if (t) clearTimeout(t);
    this.idleTimer = this.resizeTimer = this.nudgeTimer = this.graceTimer = null;
    this.requestedDetach = true;
    this.pty?.kill();
    this.pty = null;
    this.state = 'detached';
  }

  private clampedSize(): { cols: number; rows: number } {
    const c = this.activeId ? this.clients.get(this.activeId) : undefined;
    const cols = Math.max(this.minCols, c?.cols ?? this.minCols);
    const rows = Math.max(this.minRows, c?.rows ?? this.minRows);
    return { cols, rows };
  }

  private resetInputGate(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.inputReady = false;
    this.seenOutput = false;
    this.pendingInput = [];
    this.pendingInputChars = 0;
  }

  private openInputGate(pty: PtyLike): void {
    if (this.pty !== pty || this.inputReady) return;
    this.inputReady = true;
    const queued = this.pendingInput;
    this.pendingInput = [];
    this.pendingInputChars = 0;
    for (const q of queued) pty.write(q);
  }

  private spawn(): void {
    this.state = 'attaching';
    this.reason = undefined;
    this.requestedDetach = false;
    this.resetInputGate();
    this.size = this.clampedSize();
    this.buffer.clear();
    let pty: PtyLike;
    try {
      pty = this.factory(this.jobId, this.cwd, this.size.cols, this.size.rows);
    } catch (e) {
      this.state = 'error';
      this.reason = `无法启动 attach：${(e as Error).message}`;
      this.broadcastState();
      return;
    }
    this.pty = pty;
    pty.onData((d) => this.onData(pty, d));
    pty.onExit((e) => this.onExit(pty, e.exitCode));
    this.state = 'attached';
    this.broadcastState();
  }

  private onData(pty: PtyLike, d: string): void {
    this.buffer.push(d);
    const frame: ServerFrame = { t: 'out', d: encodeB64(d) };
    for (const c of this.clients.values()) c.send(frame);
    if (!this.seenOutput && this.pty === pty) {
      this.seenOutput = true;
      if (this.inputGraceMs <= 0) this.openInputGate(pty);
      else this.graceTimer = setTimeout(() => { this.graceTimer = null; this.openInputGate(pty); }, this.inputGraceMs);
    }
  }

  private onExit(pty: PtyLike, exitCode: number): void {
    if (this.pty !== pty) return; // 旧进程的迟到退出事件
    this.pty = null;
    this.resetInputGate();
    if (this.requestedDetach) {
      this.requestedDetach = false;
      this.state = 'detached';
      this.reason = undefined;
    } else if (this.buffer.tail(2048).includes(TAKEOVER_MARKER)) {
      this.state = 'taken_over';
      this.reason = '已被本地窗口接管';
    } else {
      const tail = stripAnsi(this.buffer.tail(400)).replace(/\s+/g, ' ').trim().slice(-200);
      this.state = 'error';
      this.reason = `attach 进程退出，退出码 ${exitCode}：${tail}`;
    }
    this.broadcastState();
    this.emit('exit', exitCode);
  }

  private scheduleResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.applySize();
    }, this.resizeDebounceMs);
  }

  private applySize(): void {
    const next = this.clampedSize();
    if (next.cols === this.size.cols && next.rows === this.size.rows) return;
    this.size = next;
    if (this.state === 'attached' && this.pty) this.pty.resize(next.cols, next.rows);
    this.broadcastState();
  }

  private scheduleNudge(): void {
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      if (this.state !== 'attached' || !this.pty) return;
      this.pty.resize(Math.max(1, this.size.cols - 1), this.size.rows);
      this.pty.resize(this.size.cols, this.size.rows);
    }, this.resizeDebounceMs + this.nudgeDelayMs);
  }
}

export class AttachManager {
  private sessions = new Map<string, AttachSession>();

  constructor(
    private readonly factory: PtyFactory,
    private readonly defaults: Omit<AttachOptions, 'jobId' | 'cwd' | 'factory'> = {},
  ) {}

  get(jobId: string, cwd: string): AttachSession {
    let s = this.sessions.get(jobId);
    if (!s) {
      s = new AttachSession({ ...this.defaults, jobId, cwd, factory: this.factory });
      this.sessions.set(jobId, s);
    }
    return s;
  }

  peek(jobId: string): AttachSession | undefined {
    return this.sessions.get(jobId);
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}

export function nodePtyFactory(claudeExe: string): PtyFactory {
  return (jobId, cwd, cols, rows) => {
    // 动态加载，避免单元测试加载原生模块
    const pty = require('node-pty') as typeof import('node-pty');
    const p = pty.spawn(claudeExe, ['attach', jobId], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
      useConpty: true,
    });
    return {
      onData: (cb) => { p.onData(cb); },
      onExit: (cb) => { p.onExit((e) => cb({ exitCode: e.exitCode })); },
      write: (d) => p.write(d),
      resize: (c, r) => p.resize(c, r),
      kill: () => p.kill(),
    };
  };
}
