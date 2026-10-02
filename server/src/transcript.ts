import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from './protocol.js';

export interface ParseStats {
  unknown: number;
  failed: number;
}

const TOOL_RESULT_MAX = 500;
const TOOL_SUMMARY_MAX = 200;
const SKIP_PREFIXES = ['<command-name>', '<command-message>', '<local-command-'];

type Block = Record<string, unknown>;

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Block => !!b && typeof b === 'object' && (b as Block).type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('\n');
  }
  return '';
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > max ? flat.slice(0, max) : flat;
}

export function parseTranscriptLine(line: string, stats: ParseStats): ChatMessage[] {
  let rec: Record<string, unknown>;
  try {
    const v = JSON.parse(line);
    if (!v || typeof v !== 'object') throw new Error('not an object');
    rec = v as Record<string, unknown>;
  } catch {
    stats.failed += 1;
    return [];
  }
  const type = rec.type;
  if (type !== 'user' && type !== 'assistant') return []; // attachment、mode 等记录是正常噪音，不计数
  if (rec.isMeta === true || rec.isSidechain === true) return [];
  const message = rec.message as Record<string, unknown> | undefined;
  if (!message || message.content === undefined) {
    stats.unknown += 1;
    return [];
  }
  const role = type as 'user' | 'assistant';
  const uuid = typeof rec.uuid === 'string' ? rec.uuid : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const parsedTs = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
  const ts = Number.isFinite(parsedTs) ? parsedTs : Date.now();
  const content = message.content;
  const out: ChatMessage[] = [];

  if (typeof content === 'string') {
    if (SKIP_PREFIXES.some((p) => content.startsWith(p))) return [];
    if (content.trim().length > 0) out.push({ id: `${uuid}:0`, ts, role, kind: 'text', text: content });
    return out;
  }
  if (!Array.isArray(content)) {
    stats.unknown += 1;
    return [];
  }
  content.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const b = raw as Block;
    const id = `${uuid}:${i}`;
    switch (b.type) {
      case 'text': {
        const text = String(b.text ?? '');
        if (text.trim().length > 0) out.push({ id, ts, role, kind: 'text', text });
        break;
      }
      case 'thinking': {
        const text = String(b.thinking ?? '');
        if (text.trim().length > 0) out.push({ id, ts, role, kind: 'thinking', text });
        break;
      }
      case 'tool_use': {
        const name = String(b.name ?? 'tool');
        let summary = '';
        try {
          summary = oneLine(JSON.stringify(b.input ?? {}), TOOL_SUMMARY_MAX);
        } catch {
          summary = '';
        }
        out.push({ id, ts, role, kind: 'tool_use', text: '', tool: { name, summary } });
        break;
      }
      case 'tool_result': {
        const text = blockText(b.content);
        out.push({ id, ts, role, kind: 'tool_result', text: text.length > TOOL_RESULT_MAX ? text.slice(0, TOOL_RESULT_MAX) : text });
        break;
      }
      default:
        break;
    }
  });
  return out;
}

export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function defaultTranscriptPath(configDir: string, cwd: string, sessionId: string): string {
  return join(configDir, 'projects', encodeProjectDir(cwd), `${sessionId}.jsonl`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function locateTranscript(configDir: string, cwd: string, sessionId: string): Promise<string | null> {
  const direct = defaultTranscriptPath(configDir, cwd, sessionId);
  if (await exists(direct)) return direct;
  const root = join(configDir, 'projects');
  let dirs: string[];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const candidate = join(root, d, `${sessionId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export class TranscriptTailer extends EventEmitter {
  readonly stats: ParseStats = { unknown: 0, failed: 0 };
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0);
  private messages: ChatMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;
  private loaded = false;

  constructor(
    readonly filePath: string,
    private readonly pollMs = 500,
    private readonly maxHistory = 2000,
  ) {
    super();
  }

  async start(): Promise<void> {
    await this.poll();
    this.loaded = true;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  history(limit: number): ChatMessage[] {
    return limit >= this.messages.length ? this.messages.slice() : this.messages.slice(this.messages.length - limit);
  }

  poll(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = this.readNew().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async readNew(): Promise<void> {
    let size: number;
    try {
      size = (await fs.stat(this.filePath)).size;
    } catch {
      return; // 文件尚不存在
    }
    if (size < this.offset) {
      this.offset = 0;
      this.pending = Buffer.alloc(0);
      this.messages = [];
    }
    if (size === this.offset) return;
    const fh = await fs.open(this.filePath, 'r');
    try {
      const len = size - this.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, this.offset);
      this.offset = size;
      this.consume(buf);
    } finally {
      await fh.close();
    }
  }

  private consume(chunk: Buffer): void {
    let data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const fresh: ChatMessage[] = [];
    let nl: number;
    while ((nl = data.indexOf(0x0a)) >= 0) {
      const line = data.subarray(0, nl).toString('utf8').replace(/\r$/, '');
      data = data.subarray(nl + 1);
      if (line.trim().length === 0) continue;
      fresh.push(...parseTranscriptLine(line, this.stats));
    }
    this.pending = Buffer.from(data);
    if (fresh.length === 0) return;
    this.messages.push(...fresh);
    if (this.messages.length > this.maxHistory) this.messages.splice(0, this.messages.length - this.maxHistory);
    if (this.loaded) this.emit('messages', fresh);
  }
}
