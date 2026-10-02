import { EventEmitter } from 'node:events';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { SessionInfo, SessionStatus } from './protocol.js';

export interface SessionRecord {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  kind: 'interactive' | 'bg';
  jobId?: string;
  status: SessionStatus;
  startedAt: number;
}

export type ProbeResult = { found: false } | { found: true; imageName: string };

export interface ProcessProbe {
  probe(pid: number): Promise<ProbeResult>;
}

export const HOST_IMAGES: readonly string[] = ['claude.exe', 'node.exe', 'bun.exe'];

export function hostImageName(imageName: string): string {
  const lower = imageName.toLowerCase();
  const i = lower.indexOf('.exe');
  return i >= 0 ? lower.slice(0, i + 4) : lower;
}

export function parseSessionFile(text: string): SessionRecord | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.pid !== 'number' || typeof o.sessionId !== 'string') return null;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const status: SessionStatus = o.status === 'busy' || o.status === 'idle' ? o.status : 'unknown';
  const kind = o.kind === 'bg' ? 'bg' : 'interactive';
  const rec: SessionRecord = {
    pid: o.pid,
    sessionId: o.sessionId,
    cwd: str('cwd'),
    name: str('name'),
    kind,
    status,
    startedAt: typeof o.startedAt === 'number' ? o.startedAt : 0,
  };
  if (kind === 'bg' && str('jobId')) rec.jobId = str('jobId');
  return rec;
}

export function toSessionInfo(rec: SessionRecord): SessionInfo {
  return {
    sessionId: rec.sessionId,
    pid: rec.pid,
    cwd: rec.cwd,
    name: rec.name,
    kind: rec.kind,
    jobId: rec.jobId,
    status: rec.status,
    startedAt: rec.startedAt,
    attachable: rec.kind === 'bg' && !!rec.jobId,
  };
}

export async function isAlive(rec: SessionRecord, probe: ProcessProbe): Promise<boolean> {
  const r = await probe.probe(rec.pid);
  if (!r.found) return false;
  return HOST_IMAGES.includes(hostImageName(r.imageName));
}

export async function listSessions(sessionsDir: string, probe: ProcessProbe): Promise<SessionInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(sessionsDir);
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    let text: string;
    try {
      text = await fs.readFile(join(sessionsDir, name), 'utf8');
    } catch {
      continue;
    }
    const rec = parseSessionFile(text);
    if (!rec) continue;
    if (!(await isAlive(rec, probe))) continue;
    out.push(toSessionInfo(rec));
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.length > 0
    ? env.CLAUDE_CONFIG_DIR
    : join(homedir(), '.claude');
}

export class TasklistProbe implements ProcessProbe {
  private cache = new Map<number, { at: number; result: ProbeResult }>();
  constructor(private readonly ttlMs = 5000) {}

  async probe(pid: number): Promise<ProbeResult> {
    const hit = this.cache.get(pid);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.result;
    const result = await this.query(pid);
    this.cache.set(pid, { at: Date.now(), result });
    return result;
  }

  private query(pid: number): Promise<ProbeResult> {
    return new Promise((resolve) => {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve({ found: false });
        // 命中时第一行形如 "claude.exe","13804","Console","1","123,456 K"
        const line = stdout.split(/\r?\n/).find((l) => l.startsWith('"'));
        if (!line) return resolve({ found: false });
        const cols = line.split('","');
        if (cols.length < 2) return resolve({ found: false });
        const imageName = cols[0].replace(/^"/, '');
        const foundPid = Number(cols[1].replace(/"/g, ''));
        if (foundPid !== pid) return resolve({ found: false });
        resolve({ found: true, imageName });
      });
    });
  }
}

export class RegistryWatcher extends EventEmitter {
  private list: SessionInfo[] = [];
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<SessionInfo[]> | null = null;

  constructor(
    private readonly sessionsDir: string,
    private readonly probe: ProcessProbe,
    private readonly pollMs = 3000,
  ) {
    super();
  }

  current(): SessionInfo[] {
    return this.list;
  }

  start(): void {
    try {
      this.watcher = watch(this.sessionsDir, () => void this.refresh());
    } catch {
      this.watcher = null; // 目录不存在时只靠轮询
    }
    this.timer = setInterval(() => void this.refresh(), this.pollMs);
    void this.refresh();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<SessionInfo[]> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = listSessions(this.sessionsDir, this.probe).then((next) => {
      const changed = JSON.stringify(next) !== JSON.stringify(this.list);
      this.list = next;
      this.refreshing = null;
      if (changed) this.emit('change', next);
      return next;
    });
    return this.refreshing;
  }
}
