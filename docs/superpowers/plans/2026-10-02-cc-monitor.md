# cc-monitor 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个运行在本机的监测器，手机在局域网内通过浏览器查看并操控用 `claude --bg` 启动的 Claude Code 会话：聊天视图读回答、终端画面看原样、输入框发 prompt。

**Architecture:** 单个 Node 进程。attach 管理器用 node-pty 运行 `claude.exe attach <id>`，独占会话并把画面复用给多个 WebSocket 客户端；转录尾随器增量读 jsonl 生成聊天消息；注册表读取器读 `~/.claude/sessions` 给出会话列表与 busy/idle；hooks 接收端接 CC 的 http 回调。前端是 Vue 3 单页应用，另有一个本地薄命令行客户端。

**Tech Stack:** Node 24、TypeScript（ESM，NodeNext）、express 5、ws、node-pty 1.1.0、qrcode-terminal、vitest；前端 Vue 3、vue-router、Vite、@xterm/xterm 6、@xterm/addon-fit、@vue/test-utils、jsdom。

**Spec:** `docs/superpowers/specs/2026-10-02-cc-monitor-design.md`

## Global Constraints

- 运行环境 Windows 11，Node 24，Claude Code 2.1.287（attach 语义在此版本实测）。node-pty 固定 `1.1.0`，npm 安装时使用预编译 ConPTY 二进制，不得引入需要编译的其他原生依赖。
- CC 本身零改动。监测器不修改 `~/.claude/settings.json`，hooks 配置只打印给用户自己粘贴。
- 监测器是会话唯一的 attach 客户端；代码里任何地方都不得向 PTY 发送 Ctrl+Z，除非是 `AttachSession.detach()` 的主动脱离。
- 服务端相对导入一律写 `.js` 后缀（NodeNext 约定），tsx、vitest、tsc 都能解析。示例路径一律用正斜杠。
- 安全：默认绑定 `0.0.0.0`、端口 `8787`、token 为 32 位十六进制随机串，保存在 `%LOCALAPPDATA%/cc-monitor/config.json`；`/api/hook` 只接受回环地址，其余路由与 WebSocket 升级都校验 token。
- 尺寸策略：PTY 跟随最近 `active`/`resize` 的客户端，列数不低于 80、行数不低于 24，200 毫秒防抖。
- 环形缓冲区 512 KB；最后一个客户端离开 10 分钟后主动脱离。
- 转录解析只认 `type` 为 `user`/`assistant` 的记录，跳过 `isMeta`、`isSidechain` 为真的记录，未知记录只计数不报错。
- 界面文案中文，像成熟产品，不出现"一期 / M1 / 下一版"之类的开发阶段措辞。
- git 提交信息中文，可带 `feat:`/`fix:`/`docs:`/`test:`/`chore:` 前缀，不加任何 Claude 署名尾注。

## Review Focus

1. **中文与多行 prompt**：输入框发送"你好\r\n世界"这类文本，CC 输入框里必须是完整的两行中文，不能被逐行提交或出现乱码。测试在 Task 2（`composePaste` 保留中文、CRLF 归一为 LF）。
2. **转录一行被分两次读到、多字节字符被截断**：尾随器按字节缓冲，解码后文本完整，不出现 U+FFFD。测试在 Task 4（`TranscriptTailer` 两次写入拆开一个汉字）。
3. **注册表文件写到一半被读到**：空文件或截断 JSON 必须被跳过，列表照常返回其余会话。测试在 Task 3（`parseSessionFile('')` 与 `listSessions` 容错）。
4. **手机竖屏 40 列**：PTY 不能被缩到 40 列，必须钳到 80×24。测试在 Task 5（`resizeClient` 钳位）。
5. **主动脱离与被动退出要分清**：`detach()` 后进程退出不能被判为 `error`；没有接管提示的意外退出必须给出退出码与输出末尾。测试在 Task 5（状态机三种退出）。

---

## 文件结构

```
cc-monitor/
  package.json                      npm workspaces 根
  .gitignore
  README.md                         用法：--bg 启动、起服务、扫码、防火墙、hooks 片段、本地客户端
  server/
    package.json  tsconfig.json  vitest.config.ts
    src/
      protocol.ts                   WebSocket 帧类型、ChatMessage、SessionInfo
      ringbuffer.ts                 定长环形缓冲区
      paste.ts                      括号粘贴封装、快捷键映射
      registry.ts                   会话注册表读取、存活校验、目录监听
      transcript.ts                 转录定位、解析、增量尾随
      attach.ts                     AttachSession 状态机、AttachManager
      config.ts                     配置文件、token、claude.exe 定位
      auth.ts                       cookie 与 token 校验
      hooks.ts                      /api/hook 接收端、settings 片段
      ws.ts                         WebSocket 路由
      index.ts                      入口
    scripts/integration-attach.ts   真实会话集成验证（手动）
    test/                           vitest 单元测试与夹具
  web/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/
      main.ts  App.vue  router.ts
      lib/protocol.ts               与 server/src/protocol.ts 保持一致的类型副本
      lib/ws.ts                     带重连的 WebSocket 客户端
      pages/SessionList.vue
      pages/SessionView.vue
      components/StatusBar.vue  ChatPane.vue  Composer.vue  QuickKeys.vue  TerminalPane.vue
    test/
  cli/
    package.json  tsconfig.json
    src/attach.ts                   本地薄客户端
```

---

### Task 0: 仓库脚手架与服务端工具链

**Files:**
- Create: `package.json`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/protocol.ts`
- Create: `server/test/protocol.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: `server/src/protocol.ts` 导出所有共享类型，后续任务只从这里导入类型：

```ts
export type AttachState = 'detached' | 'attaching' | 'attached' | 'taken_over' | 'error';
export type SessionStatus = 'busy' | 'idle' | 'unknown';
export interface SessionInfo {
  sessionId: string; pid: number; cwd: string; name: string;
  kind: 'interactive' | 'bg'; jobId?: string; status: SessionStatus;
  startedAt: number; attachable: boolean;
}
export interface ChatMessage {
  id: string; ts: number; role: 'user' | 'assistant';
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text: string; tool?: { name: string; summary: string };
}
export type ClientFrame =
  | { t: 'in'; d: string } | { t: 'paste'; text: string } | { t: 'key'; name: string }
  | { t: 'resize'; cols: number; rows: number } | { t: 'active' } | { t: 'attach' };
export interface StateFrame {
  t: 'state'; attach: AttachState; reason?: string; status: SessionStatus;
  size: { cols: number; rows: number }; unknownRecords: number; attachable: boolean;
}
export type ServerFrame =
  | { t: 'replay'; d: string } | { t: 'out'; d: string } | StateFrame
  | { t: 'chat'; messages: ChatMessage[] } | { t: 'hook'; event: string; data: unknown }
  | { t: 'sessions'; list: SessionInfo[] } | { t: 'error'; message: string };
export function encodeB64(s: string): string;   // UTF-8 → base64
export function decodeB64(b: string): string;   // base64 → UTF-8
```

- [ ] **Step 1: 写根 package.json 与 .gitignore**

`package.json`：

```json
{
  "name": "cc-monitor",
  "private": true,
  "workspaces": ["server", "web", "cli"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "dev:server": "npm run dev -w server",
    "dev:web": "npm run dev -w web",
    "start": "npm run start -w server"
  }
}
```

`.gitignore` 追加两行：

```
server/dist/
web/dist/
```

- [ ] **Step 2: 写 server/package.json、tsconfig、vitest 配置**

`server/package.json`：

```json
{
  "name": "@cc-monitor/server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "it:attach": "tsx scripts/integration-attach.ts"
  },
  "dependencies": {
    "express": "^5.1.0",
    "node-pty": "1.1.0",
    "qrcode-terminal": "^0.12.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/qrcode-terminal": "^0.12.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`server/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "scripts"],
  "exclude": ["test", "dist"]
}
```

`server/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 3: 安装依赖**

Run: `npm install`（在仓库根目录）
Expected: node-pty 不触发编译，输出里没有 `node-gyp rebuild`；`server/node_modules/node-pty/build/Release/conpty` 存在（workspace 可能提升到根 `node_modules`，两处任一存在即可）。

- [ ] **Step 4: 写 protocol 的失败测试**

`server/test/protocol.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { encodeB64, decodeB64 } from '../src/protocol.js';

describe('base64 helpers', () => {
  it('round-trips UTF-8 text including Chinese and escape bytes', () => {
    const s = '\x1b[200~你好\n世界\x1b[201~';
    expect(decodeB64(encodeB64(s))).toBe(s);
  });
  it('encodes to standard base64', () => {
    expect(encodeB64('hi')).toBe('aGk=');
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

Run: `npm test -w server`
Expected: FAIL，提示找不到 `../src/protocol.js`。

- [ ] **Step 6: 写 protocol.ts**

`server/src/protocol.ts`：

```ts
export type AttachState = 'detached' | 'attaching' | 'attached' | 'taken_over' | 'error';
export type SessionStatus = 'busy' | 'idle' | 'unknown';

export interface SessionInfo {
  sessionId: string;
  pid: number;
  cwd: string;
  name: string;
  kind: 'interactive' | 'bg';
  jobId?: string;
  status: SessionStatus;
  startedAt: number;
  attachable: boolean;
}

export interface ChatMessage {
  id: string;
  ts: number;
  role: 'user' | 'assistant';
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text: string;
  tool?: { name: string; summary: string };
}

export type ClientFrame =
  | { t: 'in'; d: string }
  | { t: 'paste'; text: string }
  | { t: 'key'; name: string }
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'active' }
  | { t: 'attach' };

export interface StateFrame {
  t: 'state';
  attach: AttachState;
  reason?: string;
  status: SessionStatus;
  size: { cols: number; rows: number };
  unknownRecords: number;
  attachable: boolean;
}

export type ServerFrame =
  | { t: 'replay'; d: string }
  | { t: 'out'; d: string }
  | StateFrame
  | { t: 'chat'; messages: ChatMessage[] }
  | { t: 'hook'; event: string; data: unknown }
  | { t: 'sessions'; list: SessionInfo[] }
  | { t: 'error'; message: string };

export function encodeB64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

export function decodeB64(b: string): string {
  return Buffer.from(b, 'base64').toString('utf8');
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test -w server`
Expected: PASS，2 个用例。

- [ ] **Step 8: 提交**

```bash
git add package.json .gitignore server/package.json server/tsconfig.json server/vitest.config.ts server/src/protocol.ts server/test/protocol.test.ts package-lock.json
git commit -m "chore: 搭建 workspaces 与服务端工具链，定义协议类型"
```

---

### Task 1: 环形缓冲区

**Files:**
- Create: `server/src/ringbuffer.ts`
- Test: `server/test/ringbuffer.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export class RingBuffer {
  constructor(capacity: number);           // 以 UTF-16 码元计数
  push(chunk: string): void;               // 超出容量时丢弃最旧内容
  toString(): string;                      // 当前保留内容，旧到新
  tail(n: number): string;                 // 最后 n 个码元
  clear(): void;
  get length(): number;
}
```

- [ ] **Step 1: 写失败测试**

`server/test/ringbuffer.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/ringbuffer.js';

describe('RingBuffer', () => {
  it('keeps everything under capacity in order', () => {
    const rb = new RingBuffer(10);
    rb.push('abc'); rb.push('def');
    expect(rb.toString()).toBe('abcdef');
    expect(rb.length).toBe(6);
  });
  it('drops oldest content when over capacity', () => {
    const rb = new RingBuffer(5);
    rb.push('abc'); rb.push('defg');
    expect(rb.toString()).toBe('cdefg');
    expect(rb.length).toBe(5);
  });
  it('handles a single chunk larger than capacity', () => {
    const rb = new RingBuffer(3);
    rb.push('abcdefgh');
    expect(rb.toString()).toBe('fgh');
  });
  it('tail returns the last n code units', () => {
    const rb = new RingBuffer(100);
    rb.push('Session opened in another window');
    expect(rb.tail(6)).toBe('window');
    expect(rb.tail(1000)).toBe('Session opened in another window');
  });
  it('clear empties the buffer', () => {
    const rb = new RingBuffer(10);
    rb.push('abc'); rb.clear();
    expect(rb.toString()).toBe('');
    expect(rb.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w server -- ringbuffer`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 写实现**

`server/src/ringbuffer.ts`：

```ts
export class RingBuffer {
  private chunks: string[] = [];
  private total = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error('capacity must be positive');
  }

  push(chunk: string): void {
    if (chunk.length === 0) return;
    if (chunk.length >= this.capacity) {
      this.chunks = [chunk.slice(chunk.length - this.capacity)];
      this.total = this.capacity;
      return;
    }
    this.chunks.push(chunk);
    this.total += chunk.length;
    while (this.total > this.capacity) {
      const over = this.total - this.capacity;
      const head = this.chunks[0];
      if (head.length <= over) {
        this.chunks.shift();
        this.total -= head.length;
      } else {
        this.chunks[0] = head.slice(over);
        this.total -= over;
      }
    }
  }

  toString(): string {
    return this.chunks.join('');
  }

  tail(n: number): string {
    const s = this.toString();
    return n >= s.length ? s : s.slice(s.length - n);
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }

  get length(): number {
    return this.total;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w server -- ringbuffer`
Expected: PASS，5 个用例。

- [ ] **Step 5: 提交**

```bash
git add server/src/ringbuffer.ts server/test/ringbuffer.test.ts
git commit -m "feat: 环形缓冲区，用于回放最近画面"
```

---
### Task 2: 括号粘贴与快捷键映射

**Files:**
- Create: `server/src/paste.ts`
- Test: `server/test/paste.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';
export const KEY_SEQUENCES: Record<string, string>;  // 'esc' | 'ctrl-c' | 'tab' | 'shift-tab' | 'up' | 'down' | 'left' | 'right' | 'enter'
export function normalizeNewlines(text: string): string;       // CRLF 与 CR 归一为 LF
export function composePaste(text: string): string;            // PASTE_START + 归一文本 + PASTE_END
export function keyToSequence(name: string): string | undefined;
export function sendPaste(write: (s: string) => void, text: string, delayMs?: number,
                          sleep?: (ms: number) => Promise<void>): Promise<void>;  // 写 body，等 delayMs，再写 '\r'
```

- [ ] **Step 1: 写失败测试**

`server/test/paste.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { composePaste, normalizeNewlines, keyToSequence, sendPaste, PASTE_START, PASTE_END } from '../src/paste.js';

describe('paste', () => {
  it('normalizes CRLF and CR to LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
  it('wraps text in bracketed paste markers and keeps Chinese intact', () => {
    const body = composePaste('你好\r\n世界');
    expect(body).toBe(PASTE_START + '你好\n世界' + PASTE_END);
  });
  it('maps quick keys to escape sequences', () => {
    expect(keyToSequence('esc')).toBe('\x1b');
    expect(keyToSequence('ctrl-c')).toBe('\x03');
    expect(keyToSequence('tab')).toBe('\t');
    expect(keyToSequence('shift-tab')).toBe('\x1b[Z');
    expect(keyToSequence('up')).toBe('\x1b[A');
    expect(keyToSequence('down')).toBe('\x1b[B');
    expect(keyToSequence('right')).toBe('\x1b[C');
    expect(keyToSequence('left')).toBe('\x1b[D');
    expect(keyToSequence('enter')).toBe('\r');
  });
  it('rejects unknown keys and never exposes ctrl-z', () => {
    expect(keyToSequence('ctrl-z')).toBeUndefined();
    expect(keyToSequence('nope')).toBeUndefined();
  });
  it('sendPaste writes body, waits, then writes CR', async () => {
    const writes: string[] = [];
    const waited: number[] = [];
    await sendPaste((s) => writes.push(s), 'hi', 50, async (ms) => { waited.push(ms); });
    expect(writes).toEqual([PASTE_START + 'hi' + PASTE_END, '\r']);
    expect(waited).toEqual([50]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w server -- paste`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 写实现**

`server/src/paste.ts`：

```ts
export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

export const KEY_SEQUENCES: Record<string, string> = {
  esc: '\x1b',
  'ctrl-c': '\x03',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
};

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function composePaste(text: string): string {
  return PASTE_START + normalizeNewlines(text) + PASTE_END;
}

export function keyToSequence(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(KEY_SEQUENCES, name) ? KEY_SEQUENCES[name] : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendPaste(
  write: (s: string) => void,
  text: string,
  delayMs = 50,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  write(composePaste(text));
  await sleep(delayMs);
  write('\r');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w server -- paste`
Expected: PASS，5 个用例。

- [ ] **Step 5: 提交**

```bash
git add server/src/paste.ts server/test/paste.test.ts
git commit -m "feat: 括号粘贴封装与终端快捷键映射"
```

---

### Task 3: 会话注册表读取与存活校验

**Files:**
- Create: `server/src/registry.ts`
- Test: `server/test/registry.test.ts`

**Interfaces:**
- Consumes: `SessionInfo`、`SessionStatus` 来自 `server/src/protocol.ts`
- Produces:

```ts
export interface SessionRecord {
  pid: number; sessionId: string; cwd: string; name: string;
  kind: 'interactive' | 'bg'; jobId?: string; status: SessionStatus; startedAt: number;
}
export type ProbeResult = { found: false } | { found: true; imageName: string };
export interface ProcessProbe { probe(pid: number): Promise<ProbeResult>; }
export const HOST_IMAGES: readonly string[];                  // ['claude.exe','node.exe','bun.exe']
export function hostImageName(imageName: string): string;     // 小写并截断到首个 '.exe'
export function parseSessionFile(text: string): SessionRecord | null;
export function toSessionInfo(rec: SessionRecord): SessionInfo;
export async function listSessions(sessionsDir: string, probe: ProcessProbe): Promise<SessionInfo[]>;
export function claudeConfigDir(env?: NodeJS.ProcessEnv): string;   // CLAUDE_CONFIG_DIR 或 ~/.claude
export class TasklistProbe implements ProcessProbe {}         // tasklist /FI "PID eq N" /FO CSV /NH，缓存 5 秒
export class RegistryWatcher extends EventEmitter {           // 事件 'change' → SessionInfo[]
  constructor(sessionsDir: string, probe: ProcessProbe, pollMs?: number);
  start(): void; stop(): void; current(): SessionInfo[]; refresh(): Promise<SessionInfo[]>;
}
```

注册表文件真实样例（`~/.claude/sessions/13804.json`，已脱敏）：

```json
{"pid":13804,"sessionId":"49fbe6a0-0e11-45fc-b89d-82bad4ea0be5","cwd":"C:/Users/me/proj","startedAt":1790929393795,"procStart":"134354029925885164","version":"2.1.287","kind":"bg","entrypoint":"cli","jobId":"49fbe6a0","name":"spike-bg-test","status":"idle","updatedAt":1790929393815}
```

交互式会话的 `kind` 是 `"interactive"`，没有 `jobId`。目录里还有 `<pid>.<hash>.key` 文件，不是 JSON，必须跳过。

- [ ] **Step 1: 写失败测试**

`server/test/registry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSessionFile, hostImageName, listSessions, toSessionInfo, claudeConfigDir,
  type ProcessProbe, type ProbeResult,
} from '../src/registry.js';

const bg = JSON.stringify({
  pid: 13804, sessionId: '49fbe6a0-0e11-45fc-b89d-82bad4ea0be5', cwd: 'C:/Users/me/proj',
  startedAt: 1790929393795, kind: 'bg', jobId: '49fbe6a0', name: 'spike-bg-test', status: 'idle',
});
const interactive = JSON.stringify({
  pid: 7288, sessionId: '64b4d103-5f51-4993-bdf5-10324f9dfefa', cwd: 'C:/Users/me/other',
  startedAt: 1790927458350, kind: 'interactive', name: 'other-80', status: 'busy',
});

function fakeProbe(map: Record<number, ProbeResult>): ProcessProbe {
  return { probe: async (pid) => map[pid] ?? { found: false } };
}

describe('parseSessionFile', () => {
  it('parses a bg record', () => {
    const rec = parseSessionFile(bg)!;
    expect(rec.kind).toBe('bg');
    expect(rec.jobId).toBe('49fbe6a0');
    expect(rec.status).toBe('idle');
    expect(rec.pid).toBe(13804);
  });
  it('returns null for empty, truncated or non-object input', () => {
    expect(parseSessionFile('')).toBeNull();
    expect(parseSessionFile('{"pid":13804,"sessionId":"abc"')).toBeNull();
    expect(parseSessionFile('[]')).toBeNull();
    expect(parseSessionFile('{"sessionId":"x"}')).toBeNull();
  });
  it('maps unknown status and kind to safe defaults', () => {
    const rec = parseSessionFile(JSON.stringify({ pid: 1, sessionId: 's', cwd: 'c', status: 'weird' }))!;
    expect(rec.status).toBe('unknown');
    expect(rec.kind).toBe('interactive');
    expect(rec.name).toBe('');
  });
});

describe('hostImageName', () => {
  it('lowercases and truncates after .exe', () => {
    expect(hostImageName('Claude.EXE')).toBe('claude.exe');
    expect(hostImageName('claude.exe.old.1234')).toBe('claude.exe');
    expect(hostImageName('bun')).toBe('bun');
  });
});

describe('listSessions', () => {
  it('keeps alive sessions, drops stale ones, skips key files and partial json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-sessions-'));
    writeFileSync(join(dir, '13804.json'), bg);
    writeFileSync(join(dir, '7288.json'), interactive);
    writeFileSync(join(dir, '999.json'), '{"pid":999,"sessionId":"dead","cwd":"x"}');
    writeFileSync(join(dir, '500.json'), '');
    writeFileSync(join(dir, '13804.abc.key'), '{"peerToken":"x"}');
    const probe = fakeProbe({
      13804: { found: true, imageName: 'claude.exe' },
      7288: { found: true, imageName: 'node.exe' },
      999: { found: true, imageName: 'notepad.exe' },
    });
    const list = await listSessions(dir, probe);
    expect(list.map((s) => s.sessionId).sort()).toEqual([
      '49fbe6a0-0e11-45fc-b89d-82bad4ea0be5', '64b4d103-5f51-4993-bdf5-10324f9dfefa',
    ]);
    const bgInfo = list.find((s) => s.kind === 'bg')!;
    expect(bgInfo.attachable).toBe(true);
    expect(bgInfo.jobId).toBe('49fbe6a0');
    expect(list.find((s) => s.kind === 'interactive')!.attachable).toBe(false);
  });
  it('returns empty list when the directory does not exist', async () => {
    const list = await listSessions(join(tmpdir(), 'ccm-does-not-exist-' + Date.now()), fakeProbe({}));
    expect(list).toEqual([]);
  });
});

describe('toSessionInfo', () => {
  it('marks only bg sessions attachable', () => {
    expect(toSessionInfo(parseSessionFile(bg)!).attachable).toBe(true);
    expect(toSessionInfo(parseSessionFile(interactive)!).attachable).toBe(false);
  });
});

describe('claudeConfigDir', () => {
  it('prefers CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: 'D:/cfg' })).toBe('D:/cfg');
  });
  it('falls back to ~/.claude', () => {
    expect(claudeConfigDir({}).replace(/\\/g, '/')).toMatch(/\/\.claude$/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w server -- registry`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 写实现**

`server/src/registry.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w server -- registry`
Expected: PASS，9 个用例。

- [ ] **Step 5: 在真机上冒烟验证 TasklistProbe**

Run（仓库根目录，有至少一个 CC 会话在跑）：

```bash
npx -w server tsx -e "import('./src/registry.js').then(async m => { const l = await m.listSessions(m.claudeConfigDir() + '/sessions', new m.TasklistProbe()); console.log(JSON.stringify(l, null, 2)); })"
```

Expected: 打印当前正在运行的会话数组，每项有 `sessionId`、`name`、`status`，没有已退出进程的残留记录。

- [ ] **Step 6: 提交**

```bash
git add server/src/registry.ts server/test/registry.test.ts
git commit -m "feat: 读取会话注册表并做进程存活校验"
```

---
### Task 4: 转录解析与增量尾随

**Files:**
- Create: `server/src/transcript.ts`
- Test: `server/test/transcript.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` 来自 `server/src/protocol.ts`
- Produces:

```ts
export interface ParseStats { unknown: number; failed: number }
export function parseTranscriptLine(line: string, stats: ParseStats): ChatMessage[];
export function encodeProjectDir(cwd: string): string;                       // 非字母数字 → '-'
export function defaultTranscriptPath(configDir: string, cwd: string, sessionId: string): string;
export async function locateTranscript(configDir: string, cwd: string, sessionId: string): Promise<string | null>;
export class TranscriptTailer extends EventEmitter {   // 事件 'messages' → ChatMessage[]（只对首次加载之后的新增触发）
  constructor(filePath: string, pollMs?: number, maxHistory?: number);
  readonly stats: ParseStats;
  start(): Promise<void>;        // 读完已有内容后返回，不触发事件
  stop(): void;
  poll(): Promise<void>;         // 读新增字节；文件不存在视为空
  history(limit: number): ChatMessage[];
}
```

转录记录的真实形状（来自 CC 2.1.287，内容已截断）。每条一行，`assistant` 记录每个内容块一条：

```json
{"type":"user","uuid":"7ada024d","parentUuid":"0949d998","timestamp":"2026-10-02T07:51:09.909Z","sessionId":"64b4d103","isSidechain":false,"cwd":"C:/Users/me/proj","version":"2.1.287","message":{"role":"user","content":"帮我看看这个目录"}}
{"type":"user","uuid":"0949d998","timestamp":"2026-10-02T07:51:09.910Z","isMeta":true,"isSidechain":false,"message":{"role":"user","content":"<local-command-caveat>..."}}
{"type":"assistant","uuid":"f6325b68","timestamp":"2026-10-02T07:56:32.274Z","isSidechain":false,"message":{"role":"assistant","content":[{"type":"thinking","thinking":"先看目录","signature":"..."}]},"apiBlockIndex":0}
{"type":"assistant","uuid":"8a5ccdf7","timestamp":"2026-10-02T07:56:32.961Z","isSidechain":false,"message":{"role":"assistant","content":[{"type":"text","text":"我先看一下目录结构。"}]},"apiBlockIndex":1}
{"type":"assistant","uuid":"2b0bfb7b","timestamp":"2026-10-02T07:56:33.213Z","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01A8","name":"Bash","input":{"command":"ls -la"}}]},"apiBlockIndex":2}
{"type":"user","uuid":"b724e631","timestamp":"2026-10-02T07:56:33.265Z","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01A8","content":"total 8\ndrwxr-xr-x ..."}]},"toolUseResult":{}}
{"type":"file-history-snapshot","messageId":"x","snapshot":{}}
```

- [ ] **Step 1: 写失败测试**

`server/test/transcript.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, openSync, writeSync, closeSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTranscriptLine, encodeProjectDir, defaultTranscriptPath, locateTranscript, TranscriptTailer,
  type ParseStats,
} from '../src/transcript.js';

const line = (o: unknown) => JSON.stringify(o);
const userText = line({ type: 'user', uuid: 'u1', timestamp: '2026-10-02T07:51:09.909Z', isSidechain: false,
  message: { role: 'user', content: '帮我看看这个目录' } });
const userMeta = line({ type: 'user', uuid: 'u2', timestamp: '2026-10-02T07:51:09.910Z', isMeta: true, isSidechain: false,
  message: { role: 'user', content: '<local-command-caveat>x</local-command-caveat>' } });
const userCommand = line({ type: 'user', uuid: 'u3', timestamp: '2026-10-02T07:51:09.911Z', isSidechain: false,
  message: { role: 'user', content: '<command-name>/model</command-name>\n<command-message>model</command-message>' } });
const thinking = line({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-02T07:56:32.274Z', isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'thinking', thinking: '先看目录', signature: 'sig' }] }, apiBlockIndex: 0 });
const text = line({ type: 'assistant', uuid: 'a2', timestamp: '2026-10-02T07:56:32.961Z', isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'text', text: '我先看一下目录结构。' }] }, apiBlockIndex: 1 });
const toolUse = line({ type: 'assistant', uuid: 'a3', timestamp: '2026-10-02T07:56:33.213Z', isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls -la' } }] }, apiBlockIndex: 2 });
const toolResult = line({ type: 'user', uuid: 'u4', timestamp: '2026-10-02T07:56:33.265Z', isSidechain: false,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'total 8\ndrwxr-xr-x .' }] }, toolUseResult: {} });
const toolResultBlocks = line({ type: 'user', uuid: 'u5', timestamp: '2026-10-02T07:56:34.000Z', isSidechain: false,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }] }] } });
const sidechain = line({ type: 'assistant', uuid: 'a4', timestamp: '2026-10-02T07:56:35.000Z', isSidechain: true,
  message: { role: 'assistant', content: [{ type: 'text', text: 'subagent output' }] } });
const snapshot = line({ type: 'file-history-snapshot', messageId: 'x', snapshot: {} });

const fresh = (): ParseStats => ({ unknown: 0, failed: 0 });

describe('parseTranscriptLine', () => {
  it('parses a plain user prompt', () => {
    const [m] = parseTranscriptLine(userText, fresh());
    expect(m).toMatchObject({ id: 'u1:0', role: 'user', kind: 'text', text: '帮我看看这个目录' });
    expect(m.ts).toBe(Date.parse('2026-10-02T07:51:09.909Z'));
  });
  it('skips meta, sidechain and slash-command records without counting them as unknown', () => {
    const s = fresh();
    expect(parseTranscriptLine(userMeta, s)).toEqual([]);
    expect(parseTranscriptLine(sidechain, s)).toEqual([]);
    expect(parseTranscriptLine(userCommand, s)).toEqual([]);
    expect(s).toEqual({ unknown: 0, failed: 0 });
  });
  it('maps assistant thinking, text and tool_use blocks', () => {
    const s = fresh();
    expect(parseTranscriptLine(thinking, s)[0]).toMatchObject({ role: 'assistant', kind: 'thinking', text: '先看目录' });
    expect(parseTranscriptLine(text, s)[0]).toMatchObject({ role: 'assistant', kind: 'text', text: '我先看一下目录结构。' });
    const tu = parseTranscriptLine(toolUse, s)[0];
    expect(tu).toMatchObject({ role: 'assistant', kind: 'tool_use', tool: { name: 'Bash', summary: '{"command":"ls -la"}' } });
  });
  it('maps tool_result with string or block content, truncated to 500 chars', () => {
    const s = fresh();
    expect(parseTranscriptLine(toolResult, s)[0]).toMatchObject({ role: 'user', kind: 'tool_result', text: 'total 8\ndrwxr-xr-x .' });
    expect(parseTranscriptLine(toolResultBlocks, s)[0].text).toBe('part1\npart2');
    const big = line({ type: 'user', uuid: 'u6', timestamp: '2026-10-02T07:56:36.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(900) }] } });
    expect(parseTranscriptLine(big, s)[0].text.length).toBe(500);
  });
  it('truncates tool_use summary to 200 chars on one line', () => {
    const l = line({ type: 'assistant', uuid: 'a5', timestamp: '2026-10-02T07:56:37.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Write', input: { content: 'a\nb'.repeat(300) } }] } });
    const summary = parseTranscriptLine(l, fresh())[0].tool!.summary;
    expect(summary.length).toBe(200);
    expect(summary).not.toContain('\n');
  });
  it('counts unknown record types and failed lines', () => {
    const s = fresh();
    expect(parseTranscriptLine(snapshot, s)).toEqual([]);
    expect(parseTranscriptLine('{not json', s)).toEqual([]);
    expect(parseTranscriptLine(line({ type: 'assistant', uuid: 'a6' }), s)).toEqual([]);
    expect(s).toEqual({ unknown: 2, failed: 1 });
  });
});

describe('paths', () => {
  it('encodes cwd like Claude Code does', () => {
    expect(encodeProjectDir('C:\\Users\\me\\Desktop\\work\\win_project\\cc-monitor')).toBe('C--Users-me-Desktop-work-win-project-cc-monitor');
    expect(encodeProjectDir('C:/Users/me/proj')).toBe('C--Users-me-proj');
  });
  it('builds the default transcript path', () => {
    expect(defaultTranscriptPath('D:/cfg', 'C:/Users/me/proj', 'abc').replace(/\\/g, '/')).toBe('D:/cfg/projects/C--Users-me-proj/abc.jsonl');
  });
  it('locates by default path, then by searching sessionId, else null', async () => {
    const cfg = mkdtempSync(join(tmpdir(), 'ccm-cfg-'));
    const direct = join(cfg, 'projects', 'C--Users-me-proj');
    const legacy = join(cfg, 'projects', 'C--Users-me-old_style');
    mkdirSync(direct, { recursive: true });
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(direct, 's1.jsonl'), '');
    writeFileSync(join(legacy, 's2.jsonl'), '');
    expect((await locateTranscript(cfg, 'C:/Users/me/proj', 's1'))!.replace(/\\/g, '/')).toBe(join(direct, 's1.jsonl').replace(/\\/g, '/'));
    expect((await locateTranscript(cfg, 'C:/Users/me/whatever', 's2'))!.replace(/\\/g, '/')).toBe(join(legacy, 's2.jsonl').replace(/\\/g, '/'));
    expect(await locateTranscript(cfg, 'C:/Users/me/proj', 'missing')).toBeNull();
  });
});

describe('TranscriptTailer', () => {
  it('loads existing content as history without emitting, then emits only new lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, userText + '\n' + text + '\n');
    const t = new TranscriptTailer(file, 60_000);
    const emitted: unknown[] = [];
    t.on('messages', (m) => emitted.push(m));
    await t.start();
    expect(t.history(10).map((m) => m.id)).toEqual(['u1:0', 'a2:0']);
    expect(emitted).toEqual([]);
    appendFileSync(file, toolUse + '\n');
    await t.poll();
    expect(emitted.length).toBe(1);
    expect((emitted[0] as { id: string }[])[0].id).toBe('a3:0');
    t.stop();
  });
  it('buffers a line split across polls, even inside a multi-byte character', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, '');
    const t = new TranscriptTailer(file, 60_000);
    const emitted: { text: string }[][] = [];
    t.on('messages', (m) => emitted.push(m));
    await t.start();
    const bytes = Buffer.from(userText + '\n', 'utf8');
    const cut = bytes.indexOf(Buffer.from('帮', 'utf8')) + 1; // 切在汉字中间
    const fd = openSync(file, 'a');
    writeSync(fd, bytes.subarray(0, cut));
    closeSync(fd);
    await t.poll();
    expect(emitted).toEqual([]);
    appendFileSync(file, bytes.subarray(cut));
    await t.poll();
    expect(emitted[0][0].text).toBe('帮我看看这个目录');
    t.stop();
  });
  it('treats a missing file as empty and picks it up once it appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'));
    const file = join(dir, 'later.jsonl');
    const t = new TranscriptTailer(file, 60_000);
    const emitted: unknown[][] = [];
    t.on('messages', (m) => emitted.push(m));
    await t.start();
    await t.poll();
    expect(t.history(10)).toEqual([]);
    writeFileSync(file, userText + '\n');
    await t.poll();
    expect(emitted.length).toBe(1);
    t.stop();
  });
  it('restarts from zero when the file shrinks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, userText + '\n' + text + '\n');
    const t = new TranscriptTailer(file, 60_000);
    await t.start();
    truncateSync(file, 0);
    writeFileSync(file, toolUse + '\n');
    await t.poll();
    expect(t.history(10).map((m) => m.id)).toEqual(['a3:0']);
    t.stop();
  });
  it('caps history length', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, Array.from({ length: 10 }, () => userText).join('\n') + '\n');
    const t = new TranscriptTailer(file, 60_000, 4);
    await t.start();
    expect(t.history(100).length).toBe(4);
    t.stop();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w server -- transcript`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 写实现**

`server/src/transcript.ts`：

```ts
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
  if (type !== 'user' && type !== 'assistant') {
    stats.unknown += 1;
    return [];
  }
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w server -- transcript`
Expected: PASS，14 个用例。

- [ ] **Step 5: 用本机真实转录冒烟**

Run（仓库根目录，把路径换成本机任意一个 jsonl）：

```bash
npx -w server tsx -e "import('./src/transcript.js').then(async m => { const t = new m.TranscriptTailer(process.argv[1]); await t.start(); console.log(t.history(5)); console.log(t.stats); t.stop(); })" "C:/Users/<用户名>/.claude/projects/C--Users-99763-Desktop-work-win-project-cc-monitor/64b4d103-5f51-4993-bdf5-10324f9dfefa.jsonl"
```

Expected: 打印最近 5 条消息，`failed` 为 0，`unknown` 是一个不大的数（attachment、mode 等记录）。

- [ ] **Step 6: 提交**

```bash
git add server/src/transcript.ts server/test/transcript.test.ts
git commit -m "feat: 转录解析与增量尾随，生成聊天消息"
```

---
### Task 5: attach 会话状态机与管理器

**Files:**
- Create: `server/src/attach.ts`
- Test: `server/test/attach.test.ts`

**Interfaces:**
- Consumes: `RingBuffer`（Task 1）、`keyToSequence`/`sendPaste`（Task 2）、`encodeB64`、`ServerFrame`、`StateFrame`、`AttachState`、`SessionStatus`（Task 0）
- Produces:

```ts
export interface PtyLike {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type PtyFactory = (jobId: string, cwd: string, cols: number, rows: number) => PtyLike;
export interface AttachClient { id: string; cols: number; rows: number; send(frame: ServerFrame): void }
export type StateExtras = Pick<StateFrame, 'status' | 'unknownRecords' | 'attachable'>;
export interface AttachOptions {
  jobId: string; cwd: string; factory: PtyFactory;
  minCols?: number; minRows?: number; bufferChars?: number; idleDetachMs?: number;
  nudgeDelayMs?: number; resizeDebounceMs?: number; sleep?: (ms: number) => Promise<void>;
}
export const TAKEOVER_MARKER = 'Session opened in another window';
export function stripAnsi(s: string): string;
export class AttachSession extends EventEmitter {       // 事件 'state' → StateFrame
  readonly jobId: string; state: AttachState; reason?: string; size: { cols: number; rows: number };
  constructor(opts: AttachOptions);
  setStateExtras(fn: () => StateExtras): void;
  addClient(c: AttachClient): void;
  removeClient(id: string): void;
  setActive(id: string): void;
  resizeClient(id: string, cols: number, rows: number): void;
  writeInput(d: string): void;
  sendKey(name: string): void;
  paste(text: string): Promise<void>;
  reattach(): void;
  detach(): void;
  broadcastState(): void;
  stateFrame(): StateFrame;
  clientCount(): number;
  dispose(): void;
}
export class AttachManager {
  constructor(factory: PtyFactory, defaults?: Omit<AttachOptions, 'jobId' | 'cwd' | 'factory'>);
  get(jobId: string, cwd: string): AttachSession;     // 不存在则创建
  peek(jobId: string): AttachSession | undefined;
  disposeAll(): void;
}
export function nodePtyFactory(claudeExe: string): PtyFactory;   // 真实实现，spawn claude.exe attach <jobId>
```

状态机：`detached → attaching → attached → (detached | taken_over | error)`。只有 `detach()` 发送 Ctrl+Z；`detach()` 之后的退出判为 `detached`；非主动退出时，缓冲区末尾含 `TAKEOVER_MARKER` 判为 `taken_over`，否则 `error`。

- [ ] **Step 1: 写失败测试**

`server/test/attach.test.ts`：

```ts
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
    s.writeInput('x');
    s.sendKey('esc');
    s.sendKey('ctrl-z');
    await s.paste('你好\r\n世界');
    expect(ptys[0].writes).toEqual(['x', '\x1b', composePaste('你好\r\n世界'), '\r']);
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
    s.detach();
    expect(ptys[0].writes).toEqual(['\x1a']);
    ptys[0].exit(0);
    expect(s.state).toBe('detached');
    expect(s.reason).toBeUndefined();
  });

  it('detaches after the last client has been gone for the idle period, unless someone returns', async () => {
    const { s, ptys } = harness();
    s.addClient(client('a', 120, 40).c);
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w server -- attach`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 写实现**

`server/src/attach.ts`：

```ts
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
  sleep?: (ms: number) => Promise<void>;
}

export const TAKEOVER_MARKER = 'Session opened in another window';
const CTRL_Z = '\x1a';

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
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly buffer: RingBuffer;
  private pty: PtyLike | null = null;
  private clients = new Map<string, AttachClient>();
  private activeId: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private resizeTimer: NodeJS.Timeout | null = null;
  private nudgeTimer: NodeJS.Timeout | null = null;
  private requestedDetach = false;
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
    this.activeId = c.id;
    if (this.state === 'attached') {
      c.send({ t: 'replay', d: encodeB64(this.buffer.toString()) });
      this.scheduleResize();
      this.scheduleNudge();
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

  writeInput(d: string): void {
    if (this.state !== 'attached' || !this.pty) return;
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
    for (const t of [this.idleTimer, this.resizeTimer, this.nudgeTimer]) if (t) clearTimeout(t);
    this.idleTimer = this.resizeTimer = this.nudgeTimer = null;
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

  private spawn(): void {
    this.state = 'attaching';
    this.reason = undefined;
    this.requestedDetach = false;
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
    pty.onData((d) => this.onData(d));
    pty.onExit((e) => this.onExit(pty, e.exitCode));
    this.state = 'attached';
    this.broadcastState();
  }

  private onData(d: string): void {
    this.buffer.push(d);
    const frame: ServerFrame = { t: 'out', d: encodeB64(d) };
    for (const c of this.clients.values()) c.send(frame);
  }

  private onExit(pty: PtyLike, exitCode: number): void {
    if (this.pty !== pty) return; // 旧进程的迟到退出事件
    this.pty = null;
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w server -- attach`
Expected: PASS，13 个用例。

- [ ] **Step 5: 跑全部服务端测试并提交**

Run: `npm test -w server`
Expected: 全部 PASS。

```bash
git add server/src/attach.ts server/test/attach.test.ts
git commit -m "feat: attach 会话状态机，支持多客户端复用、尺寸策略与接管检测"
```

---
### Task 6: 配置文件、token 与访问校验

**Files:**
- Create: `server/src/config.ts`
- Create: `server/src/auth.ts`
- Test: `server/test/config.test.ts`
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
// config.ts
export interface Config {
  port: number; bind: string; token: string; minCols: number; minRows: number;
  idleDetachMinutes: number; ringBufferKB: number; claudeExe: string;
}
export function defaultConfigPath(env?: NodeJS.ProcessEnv): string;   // %LOCALAPPDATA%/cc-monitor/config.json
export function randomToken(): string;                                 // 32 位十六进制
export function findClaudeExe(env?: NodeJS.ProcessEnv): string | null; // %APPDATA%/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe
export function loadOrCreateConfig(path: string, env?: NodeJS.ProcessEnv): Config;  // 不存在则创建并生成 token；CCM_PORT / CCM_BIND 环境变量覆盖
// auth.ts
export const COOKIE_NAME = 'ccm';
export function parseCookies(header: string | undefined): Record<string, string>;
export function tokenFromRequest(req: { headers: IncomingHttpHeaders; url?: string }): string | undefined;
export function isAuthorized(req: { headers: IncomingHttpHeaders; url?: string }, token: string): boolean;
export function authMiddleware(token: string): RequestHandler;        // /api/hook 不经此中间件；?t= 正确则下发 cookie
```

- [ ] **Step 1: 写 config 的失败测试**

`server/test/config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfigPath, randomToken, findClaudeExe, loadOrCreateConfig } from '../src/config.js';

describe('config', () => {
  it('builds the default path under LOCALAPPDATA', () => {
    expect(defaultConfigPath({ LOCALAPPDATA: 'C:/Users/me/AppData/Local' }).replace(/\\/g, '/'))
      .toBe('C:/Users/me/AppData/Local/cc-monitor/config.json');
  });
  it('generates 32 hex chars', () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
  it('finds claude.exe under APPDATA npm, else null', () => {
    const appdata = mkdtempSync(join(tmpdir(), 'ccm-appdata-'));
    const bin = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'claude.exe'), '');
    expect(findClaudeExe({ APPDATA: appdata })).toBe(join(bin, 'claude.exe'));
    expect(findClaudeExe({ APPDATA: join(appdata, 'nope') })).toBeNull();
  });
  it('creates the file with a token on first load and keeps it on the next', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-cfg-'));
    const path = join(dir, 'sub', 'config.json');
    const env = { APPDATA: dir };
    mkdirSync(join(dir, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), { recursive: true });
    writeFileSync(join(dir, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), '');
    const first = loadOrCreateConfig(path, env);
    expect(existsSync(path)).toBe(true);
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(first.port).toBe(8787);
    expect(first.bind).toBe('0.0.0.0');
    expect(first.minCols).toBe(80);
    expect(first.idleDetachMinutes).toBe(10);
    const second = loadOrCreateConfig(path, env);
    expect(second.token).toBe(first.token);
    expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe(first.token);
  });
  it('applies file values and env overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ token: 'a'.repeat(32), port: 9000, claudeExe: 'C:/x/claude.exe', minCols: 100 }));
    const cfg = loadOrCreateConfig(path, { CCM_PORT: '9100', CCM_BIND: '192.168.1.5' });
    expect(cfg.port).toBe(9100);
    expect(cfg.bind).toBe('192.168.1.5');
    expect(cfg.minCols).toBe(100);
    expect(cfg.claudeExe).toBe('C:/x/claude.exe');
  });
  it('throws a readable error when claude.exe cannot be found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-cfg-'));
    expect(() => loadOrCreateConfig(join(dir, 'config.json'), { APPDATA: join(dir, 'none') })).toThrow(/claudeExe/);
  });
  it('throws on invalid JSON instead of silently overwriting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, '{broken');
    expect(() => loadOrCreateConfig(path, {})).toThrow(/config\.json/);
  });
});
```

- [ ] **Step 2: 写 auth 的失败测试**

`server/test/auth.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCookies, tokenFromRequest, isAuthorized, authMiddleware, COOKIE_NAME } from '../src/auth.js';

const TOKEN = 'f'.repeat(32);

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return { res, headers };
}

describe('auth', () => {
  it('parses cookies', () => {
    expect(parseCookies('a=1; ccm=abc; x=y=z')).toEqual({ a: '1', ccm: 'abc', x: 'y=z' });
    expect(parseCookies(undefined)).toEqual({});
  });
  it('reads the token from query or cookie', () => {
    expect(tokenFromRequest({ headers: {}, url: '/?t=abc' })).toBe('abc');
    expect(tokenFromRequest({ headers: { cookie: `${COOKIE_NAME}=def` }, url: '/' })).toBe('def');
    expect(tokenFromRequest({ headers: {}, url: '/' })).toBeUndefined();
  });
  it('authorizes only an exact token', () => {
    expect(isAuthorized({ headers: {}, url: `/?t=${TOKEN}` }, TOKEN)).toBe(true);
    expect(isAuthorized({ headers: { cookie: `${COOKIE_NAME}=${TOKEN}` }, url: '/' }, TOKEN)).toBe(true);
    expect(isAuthorized({ headers: {}, url: `/?t=${TOKEN.slice(1)}` }, TOKEN)).toBe(false);
    expect(isAuthorized({ headers: {}, url: '/' }, TOKEN)).toBe(false);
  });
  it('middleware sets the cookie on a valid query token and passes', () => {
    const mw = authMiddleware(TOKEN);
    const { res, headers } = fakeRes();
    let passed = false;
    mw({ headers: {}, url: `/?t=${TOKEN}`, path: '/' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(true);
    expect(headers['Set-Cookie']).toContain(`${COOKIE_NAME}=${TOKEN}`);
    expect(headers['Set-Cookie']).toContain('HttpOnly');
    expect(headers['Set-Cookie']).toContain('SameSite=Lax');
  });
  it('middleware rejects missing or wrong tokens with 401', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ headers: {}, url: '/api/sessions', path: '/api/sessions' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });
  it('middleware lets /api/hook through untouched', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ headers: {}, url: '/api/hook', path: '/api/hook' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -w server -- config auth`
Expected: FAIL，两个模块都找不到。

- [ ] **Step 4: 写 config.ts**

`server/src/config.ts`：

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  port: number;
  bind: string;
  token: string;
  minCols: number;
  minRows: number;
  idleDetachMinutes: number;
  ringBufferKB: number;
  claudeExe: string;
}

interface ConfigFile {
  port?: number;
  bind?: string;
  token?: string;
  minCols?: number;
  minRows?: number;
  idleDetachMinutes?: number;
  ringBufferKB?: number;
  claudeExe?: string;
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA && env.LOCALAPPDATA.length > 0 ? env.LOCALAPPDATA : join(homedir(), 'AppData', 'Local');
  return join(base, 'cc-monitor', 'config.json');
}

export function randomToken(): string {
  return randomBytes(16).toString('hex');
}

export function findClaudeExe(env: NodeJS.ProcessEnv = process.env): string | null {
  const appdata = env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(homedir(), 'AppData', 'Roaming');
  const candidate = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return existsSync(candidate) ? candidate : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

export function loadOrCreateConfig(path: string, env: NodeJS.ProcessEnv = process.env): Config {
  let file: ConfigFile = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
    } catch (e) {
      throw new Error(`config.json 不是合法 JSON（${path}）：${(e as Error).message}`);
    }
  }
  let dirty = false;
  if (typeof file.token !== 'string' || !/^[0-9a-f]{32}$/.test(file.token)) {
    file.token = randomToken();
    dirty = true;
  }
  if (dirty) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
  }
  const claudeExe = typeof file.claudeExe === 'string' && file.claudeExe.length > 0 ? file.claudeExe : findClaudeExe(env);
  if (!claudeExe) {
    throw new Error(`找不到 claude.exe，请在 ${path} 里设置 claudeExe 为 Claude Code 原生二进制的完整路径`);
  }
  const envPort = env.CCM_PORT ? Number(env.CCM_PORT) : NaN;
  return {
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : num(file.port, 8787),
    bind: env.CCM_BIND && env.CCM_BIND.length > 0 ? env.CCM_BIND : (typeof file.bind === 'string' && file.bind ? file.bind : '0.0.0.0'),
    token: file.token,
    minCols: num(file.minCols, 80),
    minRows: num(file.minRows, 24),
    idleDetachMinutes: num(file.idleDetachMinutes, 10),
    ringBufferKB: num(file.ringBufferKB, 512),
    claudeExe,
  };
}
```

- [ ] **Step 5: 写 auth.ts**

`server/src/auth.ts`：

```ts
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';

export const COOKIE_NAME = 'ccm';
const HOOK_PATH = '/api/hook';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function tokenFromRequest(req: { headers: IncomingHttpHeaders; url?: string }): string | undefined {
  const url = new URL(req.url ?? '/', 'http://local');
  const q = url.searchParams.get('t');
  if (q) return q;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME];
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function isAuthorized(req: { headers: IncomingHttpHeaders; url?: string }, token: string): boolean {
  const given = tokenFromRequest(req);
  return typeof given === 'string' && equal(given, token);
}

export function authMiddleware(token: string): RequestHandler {
  return (req, res, next) => {
    if (req.path === HOOK_PATH) return next();
    if (!isAuthorized(req, token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.searchParams.get('t')) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    next();
  };
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -w server -- config auth`
Expected: PASS，13 个用例。

- [ ] **Step 7: 提交**

```bash
git add server/src/config.ts server/src/auth.ts server/test/config.test.ts server/test/auth.test.ts
git commit -m "feat: 配置文件与 token 访问校验"
```

---
### Task 7: hooks 接收端、WebSocket 路由与服务入口

**Files:**
- Create: `server/src/hooks.ts`
- Create: `server/src/ws.ts`
- Create: `server/src/index.ts`
- Test: `server/test/hooks.test.ts`
- Test: `server/test/ws.test.ts`

**Interfaces:**
- Consumes: `RegistryWatcher`/`TasklistProbe`/`claudeConfigDir`（Task 3）、`TranscriptTailer`/`locateTranscript`/`defaultTranscriptPath`/`ParseStats`（Task 4）、`AttachManager`/`AttachSession`/`AttachClient`/`nodePtyFactory`（Task 5）、`loadOrCreateConfig`/`defaultConfigPath`（Task 6）、`authMiddleware`/`isAuthorized`（Task 6）、协议类型（Task 0）
- Produces:

```ts
// hooks.ts
export interface HookEvent { sessionId: string; event: string; data: Record<string, unknown> }
export function isLoopback(addr: string | undefined): boolean;
export function hookHandler(bus: EventEmitter): RequestHandler;        // 触发 bus.emit('hook', HookEvent)
export function hooksRouter(bus: EventEmitter): Router;                // POST /api/hook，内含 express.json()
export function hooksSettingsSnippet(port: number): string;            // 可粘贴进 settings.json 的 JSON 文本
// ws.ts
export class TranscriptHub {
  constructor(configDir: string, pollMs?: number);
  getTailer(info: SessionInfo): Promise<TranscriptTailer>;
  subscribe(info: SessionInfo, cb: (m: ChatMessage[]) => void): Promise<() => void>;   // 返回取消函数
  stats(sessionId: string): ParseStats;
  history(info: SessionInfo, limit: number): Promise<ChatMessage[]>;
  stopAll(): void;
}
export interface WsDeps { token: string; registry: RegistryWatcher; attach: AttachManager; transcripts: TranscriptHub; hookBus: EventEmitter }
export function attachWebSocketServer(server: HttpServer, deps: WsDeps): WebSocketServer;
export function lanAddresses(): string[];   // 非回环 IPv4
```

WebSocket 入口：`/ws?list=1` 推会话列表；`/ws?sid=<sessionId>` 进入会话页。两者都要求 cookie 或 `?t=` 正确。

- [ ] **Step 1: 写 hooks 的失败测试**

`server/test/hooks.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { isLoopback, hookHandler, hooksSettingsSnippet, type HookEvent } from '../src/hooks.js';

function fakeRes() {
  const res = {
    statusCode: 200,
    ended: false,
    status(code: number) { this.statusCode = code; return this; },
    end() { this.ended = true; return this; },
    json() { this.ended = true; return this; },
  };
  return res;
}

describe('hooks', () => {
  it('recognizes loopback addresses only', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.8')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
  it('rejects non-loopback callers with 403 and emits nothing', () => {
    const bus = new EventEmitter();
    const got: HookEvent[] = [];
    bus.on('hook', (e) => got.push(e));
    const res = fakeRes();
    hookHandler(bus)({ socket: { remoteAddress: '192.168.1.8' }, body: { hook_event_name: 'Stop', session_id: 's' } } as never, res as never, () => {});
    expect(res.statusCode).toBe(403);
    expect(got).toEqual([]);
  });
  it('rejects bodies without event name or session id with 400', () => {
    const bus = new EventEmitter();
    const res = fakeRes();
    hookHandler(bus)({ socket: { remoteAddress: '127.0.0.1' }, body: { foo: 1 } } as never, res as never, () => {});
    expect(res.statusCode).toBe(400);
  });
  it('emits the event and answers 200 with an empty body', () => {
    const bus = new EventEmitter();
    const got: HookEvent[] = [];
    bus.on('hook', (e) => got.push(e));
    const res = fakeRes();
    const body = { hook_event_name: 'Notification', session_id: 'abc', notification_type: 'permission_prompt', message: 'x' };
    hookHandler(bus)({ socket: { remoteAddress: '::1' }, body } as never, res as never, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(got).toEqual([{ sessionId: 'abc', event: 'Notification', data: body }]);
  });
  it('produces a settings snippet with the three events pointing at loopback', () => {
    const snippet = JSON.parse(hooksSettingsSnippet(8787));
    for (const ev of ['PermissionRequest', 'Notification', 'Stop']) {
      expect(snippet.hooks[ev][0].hooks[0]).toEqual({ type: 'http', url: 'http://127.0.0.1:8787/api/hook', timeout: 5 });
    }
  });
});
```

- [ ] **Step 2: 写 ws 的失败测试**

`server/test/ws.test.ts`：

```ts
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
  const attach = new AttachManager(() => { const p = new FakePty(); ptys.push(p); return p; }, { sleep: async () => {} });
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
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -w server -- hooks ws`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 写 hooks.ts**

`server/src/hooks.ts`：

```ts
import { Router, json, type RequestHandler } from 'express';
import type { EventEmitter } from 'node:events';

export interface HookEvent {
  sessionId: string;
  event: string;
  data: Record<string, unknown>;
}

export function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function hookHandler(bus: EventEmitter): RequestHandler {
  return (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) {
      res.status(403).end();
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || typeof body.hook_event_name !== 'string' || typeof body.session_id !== 'string') {
      res.status(400).end();
      return;
    }
    const ev: HookEvent = { sessionId: body.session_id, event: body.hook_event_name, data: body };
    bus.emit('hook', ev);
    res.status(200).end();
  };
}

export function hooksRouter(bus: EventEmitter): Router {
  const r = Router();
  r.post('/api/hook', json({ limit: '1mb' }), hookHandler(bus));
  return r;
}

export function hooksSettingsSnippet(port: number): string {
  const handler = [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hook`, timeout: 5 }] }];
  return JSON.stringify({ hooks: { PermissionRequest: handler, Notification: handler, Stop: handler } }, null, 2);
}
```

- [ ] **Step 5: 写 ws.ts**

`server/src/ws.ts`：

```ts
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
```

- [ ] **Step 6: 写 index.ts**

`server/src/index.ts`：

```ts
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import qrcode from 'qrcode-terminal';
import { loadOrCreateConfig, defaultConfigPath } from './config.js';
import { authMiddleware } from './auth.js';
import { RegistryWatcher, TasklistProbe, claudeConfigDir } from './registry.js';
import { AttachManager, nodePtyFactory } from './attach.js';
import { TranscriptHub, attachWebSocketServer, lanAddresses } from './ws.js';
import { hooksRouter, hooksSettingsSnippet } from './hooks.js';

const configPath = defaultConfigPath();
const cfg = loadOrCreateConfig(configPath);
const configDir = claudeConfigDir();

const registry = new RegistryWatcher(join(configDir, 'sessions'), new TasklistProbe());
const attach = new AttachManager(nodePtyFactory(cfg.claudeExe), {
  minCols: cfg.minCols,
  minRows: cfg.minRows,
  bufferChars: cfg.ringBufferKB * 1024,
  idleDetachMs: cfg.idleDetachMinutes * 60_000,
});
const transcripts = new TranscriptHub(configDir);
const hookBus = new EventEmitter();

const app = express();
app.use(hooksRouter(hookBus));
app.use(authMiddleware(cfg.token));

app.get('/api/sessions', async (_req, res) => {
  res.json(await registry.refresh());
});

app.get('/api/sessions/:sid/transcript', async (req, res) => {
  const info = registry.current().find((s) => s.sessionId === req.params.sid);
  if (!info) {
    res.status(404).json({ error: '会话不存在' });
    return;
  }
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  res.json(await transcripts.history(info, limit));
});

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('网页尚未构建：先运行 npm run build -w web'));
}

const server = createServer(app);
attachWebSocketServer(server, { token: cfg.token, registry, attach, transcripts, hookBus });
registry.start();

server.listen(cfg.port, cfg.bind, () => {
  const hosts = cfg.bind === '0.0.0.0' ? lanAddresses() : [cfg.bind];
  console.log(`cc-monitor 已启动，配置文件：${configPath}`);
  for (const h of hosts) console.log(`  http://${h}:${cfg.port}/?t=${cfg.token}`);
  if (hosts[0]) qrcode.generate(`http://${hosts[0]}:${cfg.port}/?t=${cfg.token}`, { small: true });
  console.log('如需手机提醒，把下面这段合并进 ~/.claude/settings.json 的 hooks：');
  console.log(hooksSettingsSnippet(cfg.port));
});

function shutdown(): void {
  registry.stop();
  transcripts.stopAll();
  attach.disposeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test -w server`
Expected: 全部 PASS，其中 hooks 5 个、ws 6 个。

- [ ] **Step 8: 启动服务冒烟**

Run: `npm run dev -w server`
Expected: 打印配置文件路径、带 token 的局域网 URL、二维码和 hooks 片段。另开一个终端：

```bash
curl -s "http://127.0.0.1:8787/api/sessions?t=<打印出来的token>"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/api/sessions"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d "{\"hook_event_name\":\"Stop\",\"session_id\":\"x\"}" "http://127.0.0.1:8787/api/hook"
```

Expected: 第一条返回会话 JSON 数组；第二条 401；第三条 200。Ctrl+C 能干净退出。

- [ ] **Step 9: 提交**

```bash
git add server/src/hooks.ts server/src/ws.ts server/src/index.ts server/test/hooks.test.ts server/test/ws.test.ts
git commit -m "feat: HTTP 接口、WebSocket 路由与 hooks 接收端，服务可启动"
```

---
### Task 8: 真实会话集成验证脚本

**Files:**
- Create: `server/scripts/integration-attach.ts`
- Modify: `README.md`（本任务先建一个只含"集成验证"一节的 README，Task 15 再补全）

**Interfaces:**
- Consumes: `AttachManager`/`nodePtyFactory`/`TAKEOVER_MARKER`/`stripAnsi`（Task 5）、`composePaste`（Task 2）、`loadOrCreateConfig`/`defaultConfigPath`（Task 6）、`ServerFrame`（Task 0）
- Produces: 无代码接口。这是手动运行的验证脚本，退出码 0 表示全部通过。

脚本做五件事：起一个真实后台会话；经 `AttachSession` attach 并确认收到画面；写入单行括号粘贴（不带回车，不触发真实对话）并用 `claude logs` 确认文字到达输入框；再起第二个 attach 触发接管，确认状态变为 `taken_over`；最后 `claude stop` 与 `claude rm` 清理。加 `--submit` 参数时会额外真的提交一条"只回复 OK"的 prompt，验证回车路径，这会消耗一次对话。

- [ ] **Step 1: 写脚本**

`server/scripts/integration-attach.ts`：

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AttachManager, nodePtyFactory, stripAnsi } from '../src/attach.js';
import { composePaste } from '../src/paste.js';
import { loadOrCreateConfig, defaultConfigPath } from '../src/config.js';
import type { ServerFrame } from '../src/protocol.js';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cwd = process.cwd();
const submit = process.argv.includes('--submit');
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function claude(...args: string[]): Promise<string> {
  const { stdout } = await run('cmd.exe', ['/c', 'claude', ...args], { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function main(): Promise<number> {
  const cfg = loadOrCreateConfig(defaultConfigPath());
  const started = await claude('--bg', '--name', 'ccm-it');
  const id = /backgrounded\s*·\s*([0-9a-f]{8})/.exec(started)?.[1];
  if (!id) { console.error('无法从输出里解析会话 id：\n' + started); return 1; }
  console.log('后台会话', id);
  await sleep(3000);

  const manager = new AttachManager(nodePtyFactory(cfg.claudeExe));
  const session = manager.get(id, cwd);
  const frames: ServerFrame[] = [];
  let text = '';
  session.addClient({ id: 'it', cols: 120, rows: 40, send: (f) => { frames.push(f); if (f.t === 'out') text += Buffer.from(f.d, 'base64').toString('utf8'); } });
  await sleep(6000);
  check('attach 后状态为 attached', session.state === 'attached', session.reason);
  check('收到了 TUI 画面', stripAnsi(text).includes('ccm-it'));

  const marker = 'ccm-it-paste-' + Date.now().toString(36);
  session.writeInput(composePaste(marker));
  await sleep(2500);
  const logs = stripAnsi(await claude('logs', id));
  check('括号粘贴的文字出现在输入框', logs.includes(marker));
  session.writeInput('\x7f'.repeat(marker.length));
  await sleep(500);

  if (submit) {
    await session.paste('只回复 OK，不要做别的');
    await sleep(20000);
    const after = stripAnsi(await claude('logs', id));
    check('提交后出现回复', /OK/.test(after));
  }

  const factory = nodePtyFactory(cfg.claudeExe);
  const second = factory(id, cwd, 100, 30);
  let secondOut = '';
  second.onData((d) => { secondOut += d; });
  await sleep(6000);
  check('第二个 attach 接管后状态为 taken_over', session.state === 'taken_over', session.state + ' ' + (session.reason ?? ''));
  check('第二个客户端拿到了画面', stripAnsi(secondOut).includes('ccm-it'));
  second.write('\x1a');
  await sleep(1500);
  second.kill();

  session.reattach();
  await sleep(6000);
  check('接管回来后重新 attached', session.state === 'attached', session.reason);
  manager.disposeAll();

  await claude('stop', id);
  await claude('rm', id);
  const list = await claude('agents', '--json');
  check('会话已清理', !list.includes(id));
  return results.every((r) => r.ok) ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行脚本**

Run（仓库根目录，确保本机没有名为 ccm-it 的残留会话）：

```bash
npm run it:attach -w server
```

Expected: 七行 PASS，退出码 0；`claude agents --json` 里没有 ccm-it。若"括号粘贴的文字出现在输入框"失败，先手动在终端 `claude attach <id>` 看输入框内容，再按 spec 5.3 的退路改为逐字写入：在 `paste.ts` 的 `sendPaste` 里把 `write(composePaste(text))` 换成按字符循环写入、每字 `await sleep(10)`，并更新 Task 2 的测试期望。

- [ ] **Step 3: 写 README 的集成验证一节**

`README.md`：

```markdown
# cc-monitor

局域网内用手机查看并操控本机的 Claude Code 会话。

## 集成验证

需要本机已安装 Claude Code 并登录。脚本会起一个名为 ccm-it 的后台会话，验证完自动清理：

    npm run it:attach -w server

加 `--submit` 会真的提交一条 prompt 验证回车路径，会消耗一次对话：

    npm run it:attach -w server -- --submit
```

- [ ] **Step 4: 提交**

```bash
git add server/scripts/integration-attach.ts README.md
git commit -m "test: 真实后台会话的 attach、粘贴与接管集成验证脚本"
```

---

### Task 9: 前端脚手架、协议副本与自动重连的 WebSocket 客户端

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/env.d.ts`
- Create: `web/src/main.ts`
- Create: `web/src/App.vue`
- Create: `web/src/router.ts`
- Create: `web/src/lib/protocol.ts`
- Create: `web/src/lib/ws.ts`
- Test: `web/test/protocol.test.ts`
- Test: `web/test/ws.test.ts`

**Interfaces:**
- Consumes: 无（协议类型在本任务复制一份）
- Produces:

```ts
// web/src/lib/protocol.ts：与 server/src/protocol.ts 的类型逐字相同，外加浏览器版 base64
export function encodeB64(s: string): string;
export function decodeB64(b: string): string;
// web/src/lib/ws.ts
export class ReconnectingSocket {
  constructor(url: string, opts?: { minDelay?: number; maxDelay?: number; factory?: (url: string) => WebSocket });
  onFrame(h: (f: ServerFrame) => void): void;
  onStatus(h: (s: 'connecting' | 'open' | 'closed') => void): void;
  connect(): void;
  send(frame: ClientFrame): boolean;     // 未连接时返回 false 并丢弃
  close(): void;                         // 不再重连
}
export function wsUrl(path: string): string;   // 根据 location 推出 ws:// 或 wss://
```

- [ ] **Step 1: 写 web/package.json、tsconfig、vite 配置、index.html**

`web/package.json`：

```json
{
  "name": "@cc-monitor/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "vue-tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "vue": "^3.5.13",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "@vue/test-utils": "^2.4.6",
    "jsdom": "^26.0.0",
    "typescript": "~5.7.0",
    "vite": "^6.2.0",
    "vitest": "^3.0.0",
    "vue-tsc": "^2.2.0"
  }
}
```

`web/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "test"]
}
```

`web/vite.config.ts`：

```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
```

`web/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
    <title>CC 监测</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/env.d.ts`：

```ts
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
```

- [ ] **Step 2: 写 main.ts、App.vue、router.ts 骨架**

`web/src/main.ts`：

```ts
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';

createApp(App).use(router).mount('#app');
```

`web/src/App.vue`：

```vue
<template>
  <router-view />
</template>

<style>
:root { color-scheme: light dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
html, body, #app { margin: 0; height: 100%; }
body { background: #111; color: #eee; }
button { font: inherit; }
</style>
```

`web/src/router.ts`：

```ts
import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/SessionList.vue') },
    { path: '/s/:sessionId', component: () => import('./pages/SessionView.vue'), props: true },
  ],
});
```

两个页面在 Task 10 和 Task 13 创建；在那之前 `vue-tsc` 会报找不到模块，所以本任务只运行 `vitest`，不运行 `build`。

- [ ] **Step 3: 安装依赖**

Run: `npm install`（仓库根目录）
Expected: 成功，无 peer 冲突报错。

- [ ] **Step 4: 写 protocol 与 ws 的失败测试**

`web/test/protocol.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { encodeB64, decodeB64 } from '../src/lib/protocol';

describe('browser base64', () => {
  it('round-trips UTF-8 including Chinese and control bytes', () => {
    const s = '\x1b[200~你好\n世界\x1b[201~';
    expect(decodeB64(encodeB64(s))).toBe(s);
  });
  it('matches the server encoding', () => {
    expect(encodeB64('hi')).toBe('aGk=');
    expect(decodeB64('5L2g5aW9')).toBe('你好');
  });
});
```

`web/test/ws.test.ts`：

```ts
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
```

- [ ] **Step 5: 运行测试确认失败**

Run: `npm test -w web`
Expected: FAIL，两个模块找不到。

- [ ] **Step 6: 写 protocol.ts 与 ws.ts**

`web/src/lib/protocol.ts`：把 `server/src/protocol.ts` 里从 `AttachState` 到 `ServerFrame` 的全部类型原样复制过来（文件头加一行注释"与 server/src/protocol.ts 保持一致，改一处必须改另一处"），然后把两个 base64 函数换成浏览器实现：

```ts
export function encodeB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodeB64(b: string): string {
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
```

`web/src/lib/ws.ts`：

```ts
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
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test -w web`
Expected: PASS，6 个用例。

- [ ] **Step 8: 提交**

```bash
git add web/package.json web/tsconfig.json web/vite.config.ts web/index.html web/src web/test package-lock.json
git commit -m "feat: 前端脚手架、协议类型副本与自动重连的 WebSocket 客户端"
```

---
### Task 10: 会话列表页与状态栏

**Files:**
- Create: `web/src/pages/SessionList.vue`
- Create: `web/src/components/StatusBar.vue`
- Test: `web/test/SessionList.test.ts`
- Test: `web/test/StatusBar.test.ts`

**Interfaces:**
- Consumes: `SessionInfo`、`StateFrame`（Task 9 的 protocol 副本）、`ReconnectingSocket`/`wsUrl`、`SocketStatus`（Task 9）
- Produces:
  - `SessionList.vue`：无 props；挂载时 `GET /api/sessions`，再连 `/ws?list=1` 接收 `sessions` 帧。
  - `StatusBar.vue`：props `state: StateFrame | null`、`socket: SocketStatus`；emits `reattach`。

- [ ] **Step 1: 写失败测试**

`web/test/SessionList.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';

const sockets: { frame: ((f: unknown) => void) | null; closed: boolean }[] = [];
vi.mock('../src/lib/ws', () => ({
  wsUrl: (p: string) => 'ws://test' + p,
  ReconnectingSocket: class {
    frame: ((f: unknown) => void) | null = null;
    closed = false;
    constructor() { sockets.push(this); }
    onFrame(h: (f: unknown) => void) { this.frame = h; }
    onStatus() {}
    connect() {}
    send() { return true; }
    close() { this.closed = true; }
  },
}));

import SessionList from '../src/pages/SessionList.vue';

const list = [
  { sessionId: 's1', pid: 1, cwd: 'C:/p/one', name: 'one', kind: 'bg', jobId: 'aaaaaaaa', status: 'busy', startedAt: 2, attachable: true },
  { sessionId: 's2', pid: 2, cwd: 'C:/p/two', name: 'two', kind: 'interactive', status: 'idle', startedAt: 1, attachable: false },
];

function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: SessionList }, { path: '/s/:sessionId', component: { template: '<div />' } }] });
  return mount(SessionList, { global: { plugins: [router] } });
}

beforeEach(() => { sockets.length = 0; });

describe('SessionList', () => {
  it('renders sessions from the API with status and read-only badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));
    const w = mountPage();
    await flushPromises();
    const rows = w.findAll('[data-test="session"]');
    expect(rows.length).toBe(2);
    expect(rows[0].text()).toContain('one');
    expect(rows[0].text()).toContain('忙碌');
    expect(rows[1].text()).toContain('只读');
    expect(rows[0].find('a').attributes('href')).toBe('/s/s1');
  });
  it('updates from the sessions frame and shows an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));
    const w = mountPage();
    await flushPromises();
    sockets[0].frame!({ t: 'sessions', list: [] });
    await flushPromises();
    expect(w.findAll('[data-test="session"]').length).toBe(0);
    expect(w.text()).toContain('没有正在运行的会话');
  });
  it('shows an error when the API fails and closes the socket on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain('加载会话列表失败');
    w.unmount();
    expect(sockets[0].closed).toBe(true);
  });
});
```

`web/test/StatusBar.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBar from '../src/components/StatusBar.vue';

const base = { t: 'state', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: true } as const;

describe('StatusBar', () => {
  it('shows attached + busy', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'attached', status: 'busy' }, socket: 'open' } });
    expect(w.text()).toContain('已连接');
    expect(w.text()).toContain('忙碌');
    expect(w.find('[data-test="reattach"]').exists()).toBe(false);
  });
  it('offers reattach when taken over and emits the event', async () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'taken_over', reason: '已被本地窗口接管' }, socket: 'open' } });
    expect(w.text()).toContain('已被本地窗口接管');
    await w.find('[data-test="reattach"]').trigger('click');
    expect(w.emitted('reattach')).toHaveLength(1);
  });
  it('shows the error reason and reattach for errors', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'error', reason: 'attach 进程退出，退出码 1：daemon not running' }, socket: 'open' } });
    expect(w.text()).toContain('daemon not running');
    expect(w.find('[data-test="reattach"]').exists()).toBe(true);
  });
  it('marks read-only sessions without a reattach button', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'detached', attachable: false, reason: '这个会话不是用 claude --bg 启动的，只能查看，不能输入' }, socket: 'open' } });
    expect(w.text()).toContain('只能查看');
    expect(w.find('[data-test="reattach"]').exists()).toBe(false);
  });
  it('shows reconnecting when the socket is closed and a format warning when unknown records pile up', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'attached', unknownRecords: 500 }, socket: 'closed' } });
    expect(w.text()).toContain('重连中');
    expect(w.text()).toContain('转录格式可能已变化');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w web`
Expected: FAIL，两个组件找不到。

- [ ] **Step 3: 写 SessionList.vue**

`web/src/pages/SessionList.vue`：

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { SessionInfo } from '../lib/protocol';
import { ReconnectingSocket, wsUrl } from '../lib/ws';

const sessions = ref<SessionInfo[]>([]);
const error = ref('');
const loaded = ref(false);
let socket: ReconnectingSocket | null = null;

const statusText = (s: SessionInfo) => (s.status === 'busy' ? '忙碌' : s.status === 'idle' ? '空闲' : '未知');

async function load() {
  try {
    const r = await fetch('/api/sessions');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    sessions.value = (await r.json()) as SessionInfo[];
    error.value = '';
  } catch (e) {
    error.value = `加载会话列表失败：${(e as Error).message}`;
  } finally {
    loaded.value = true;
  }
}

onMounted(() => {
  void load();
  socket = new ReconnectingSocket(wsUrl('/ws?list=1'));
  socket.onFrame((f) => {
    if (f.t === 'sessions') sessions.value = f.list;
  });
  socket.connect();
});
onUnmounted(() => socket?.close());
</script>

<template>
  <main class="list">
    <h1>Claude Code 会话</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loaded && sessions.length === 0" class="empty">没有正在运行的会话。用 <code>claude --bg</code> 启动一个后再回来。</p>
    <ul>
      <li v-for="s in sessions" :key="s.sessionId" data-test="session">
        <router-link :to="`/s/${s.sessionId}`">
          <span class="dot" :class="s.status" />
          <span class="name">{{ s.name || s.sessionId.slice(0, 8) }}</span>
          <span class="badge" v-if="!s.attachable">只读</span>
          <span class="status">{{ statusText(s) }}</span>
          <span class="cwd">{{ s.cwd }}</span>
        </router-link>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.list { padding: 16px; max-width: 720px; margin: 0 auto; }
h1 { font-size: 18px; margin: 0 0 12px; }
ul { list-style: none; padding: 0; margin: 0; }
li a { display: grid; grid-template-columns: 12px 1fr auto auto; grid-template-areas: "dot name badge status" "dot cwd cwd cwd"; gap: 4px 8px; align-items: center; padding: 12px; margin-bottom: 8px; border-radius: 10px; background: #1d1d1d; color: inherit; text-decoration: none; }
.dot { grid-area: dot; width: 10px; height: 10px; border-radius: 50%; background: #666; }
.dot.busy { background: #f0a030; }
.dot.idle { background: #3cc26a; }
.name { grid-area: name; font-weight: 600; }
.badge { grid-area: badge; font-size: 12px; padding: 1px 6px; border-radius: 6px; background: #444; }
.status { grid-area: status; font-size: 13px; color: #aaa; }
.cwd { grid-area: cwd; font-size: 12px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.error { color: #ff7b7b; }
.empty { color: #aaa; }
</style>
```

- [ ] **Step 4: 写 StatusBar.vue**

`web/src/components/StatusBar.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { StateFrame } from '../lib/protocol';
import type { SocketStatus } from '../lib/ws';

const props = defineProps<{ state: StateFrame | null; socket: SocketStatus }>();
const emit = defineEmits<{ reattach: [] }>();

const attachText = computed(() => {
  const s = props.state;
  if (!s) return '等待状态';
  switch (s.attach) {
    case 'attached': return '已连接';
    case 'attaching': return '连接中';
    case 'taken_over': return s.reason ?? '已被本地窗口接管';
    case 'error': return s.reason ?? '连接出错';
    default: return s.attachable ? '未连接' : (s.reason ?? '只能查看');
  }
});
const statusText = computed(() => (props.state?.status === 'busy' ? '忙碌' : props.state?.status === 'idle' ? '空闲' : ''));
const canReattach = computed(() => !!props.state && props.state.attachable && props.state.attach !== 'attached' && props.state.attach !== 'attaching');
const formatWarning = computed(() => (props.state?.unknownRecords ?? 0) > 200);
</script>

<template>
  <div class="bar">
    <span class="net" v-if="socket !== 'open'">网络断开，重连中</span>
    <span class="attach" :class="state?.attach">{{ attachText }}</span>
    <span class="status" v-if="statusText">{{ statusText }}</span>
    <span class="size" v-if="state">{{ state.size.cols }}×{{ state.size.rows }}</span>
    <button v-if="canReattach" data-test="reattach" @click="emit('reattach')">接管回来</button>
    <span class="warn" v-if="formatWarning">转录格式可能已变化，聊天视图可能不完整</span>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; font-size: 13px; background: #1a1a1a; border-bottom: 1px solid #2a2a2a; }
.net { color: #ff7b7b; }
.attach.attached { color: #3cc26a; }
.attach.taken_over, .attach.error { color: #f0a030; }
.size { color: #777; }
.warn { color: #f0a030; width: 100%; }
button { padding: 4px 10px; border-radius: 6px; border: 1px solid #555; background: #2a2a2a; color: #eee; }
</style>
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -w web`
Expected: PASS，SessionList 3 个、StatusBar 5 个，加上 Task 9 的 6 个。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/SessionList.vue web/src/components/StatusBar.vue web/test/SessionList.test.ts web/test/StatusBar.test.ts
git commit -m "feat: 会话列表页与会话状态栏"
```

---

### Task 11: 输入框、快捷键条与聊天视图

**Files:**
- Create: `web/src/components/Composer.vue`
- Create: `web/src/components/QuickKeys.vue`
- Create: `web/src/components/ChatPane.vue`
- Test: `web/test/Composer.test.ts`
- Test: `web/test/QuickKeys.test.ts`
- Test: `web/test/ChatPane.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`（Task 9 的 protocol 副本）
- Produces:
  - `Composer.vue`：props `disabled?: boolean`；emits `send(text: string)`。发送后清空；Ctrl+Enter 或 Cmd+Enter 发送；空白不发送。
  - `QuickKeys.vue`：props `disabled?: boolean`；emits `key(name: string)`，name 取值 `esc | ctrl-c | tab | shift-tab | up | down | left | right | enter`。
  - `ChatPane.vue`：props `messages: ChatMessage[]`、`emptyHint: string`；暴露 `stick: Ref<boolean>`。

- [ ] **Step 1: 写失败测试**

`web/test/Composer.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Composer from '../src/components/Composer.vue';

describe('Composer', () => {
  it('emits send with the text and clears the box', async () => {
    const w = mount(Composer);
    await w.find('textarea').setValue('帮我看看\n第二行');
    await w.find('[data-test="send"]').trigger('click');
    expect(w.emitted('send')).toEqual([['帮我看看\n第二行']]);
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
  it('ignores blank text', async () => {
    const w = mount(Composer);
    await w.find('textarea').setValue('   \n');
    await w.find('[data-test="send"]').trigger('click');
    expect(w.emitted('send')).toBeUndefined();
  });
  it('sends on ctrl+enter', async () => {
    const w = mount(Composer);
    await w.find('textarea').setValue('go');
    await w.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(w.emitted('send')).toEqual([['go']]);
  });
  it('disables controls when asked', () => {
    const w = mount(Composer, { props: { disabled: true } });
    expect(w.find('textarea').attributes('disabled')).toBeDefined();
    expect(w.find('[data-test="send"]').attributes('disabled')).toBeDefined();
  });
});
```

`web/test/QuickKeys.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import QuickKeys from '../src/components/QuickKeys.vue';

describe('QuickKeys', () => {
  it('emits the key name for each button', async () => {
    const w = mount(QuickKeys);
    const names = w.findAll('button').map((b) => b.attributes('data-key'));
    expect(names).toEqual(['esc', 'ctrl-c', 'tab', 'shift-tab', 'up', 'down', 'left', 'right', 'enter']);
    await w.find('[data-key="esc"]').trigger('click');
    expect(w.emitted('key')).toEqual([['esc']]);
  });
});
```

`web/test/ChatPane.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ChatPane from '../src/components/ChatPane.vue';

const msgs = [
  { id: 'u1:0', ts: 1, role: 'user', kind: 'text', text: '帮我看看' },
  { id: 'a1:0', ts: 2, role: 'assistant', kind: 'thinking', text: '想一下' },
  { id: 'a2:0', ts: 3, role: 'assistant', kind: 'tool_use', text: '', tool: { name: 'Bash', summary: '{"command":"ls"}' } },
  { id: 'u2:0', ts: 4, role: 'user', kind: 'tool_result', text: 'total 8' },
  { id: 'a3:0', ts: 5, role: 'assistant', kind: 'text', text: '目录里有 8 个文件' },
] as const;

describe('ChatPane', () => {
  it('renders each kind with its own class and collapses thinking and tools', () => {
    const w = mount(ChatPane, { props: { messages: [...msgs], emptyHint: '空' } });
    expect(w.findAll('.msg').length).toBe(5);
    expect(w.find('.msg.user.text').text()).toContain('帮我看看');
    expect(w.find('.msg.assistant.thinking details').exists()).toBe(true);
    expect(w.find('.msg.tool_use summary').text()).toContain('Bash');
    expect(w.find('.msg.tool_result').text()).toContain('total 8');
  });
  it('shows the empty hint without messages', () => {
    const w = mount(ChatPane, { props: { messages: [], emptyHint: '发出第一条 prompt 后这里会显示对话' } });
    expect(w.text()).toContain('发出第一条 prompt 后这里会显示对话');
  });
  it('stops sticking to the bottom when the user scrolls up, and sticks again at the bottom', async () => {
    const w = mount(ChatPane, { props: { messages: [...msgs], emptyHint: '' } });
    const box = w.find('.chat').element as HTMLElement;
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
    box.scrollTop = 100;
    await w.find('.chat').trigger('scroll');
    expect((w.vm as unknown as { stick: boolean }).stick).toBe(false);
    box.scrollTop = 700;
    await w.find('.chat').trigger('scroll');
    expect((w.vm as unknown as { stick: boolean }).stick).toBe(true);
    await w.setProps({ messages: [...msgs, { id: 'a4:0', ts: 6, role: 'assistant', kind: 'text', text: '新消息' }] });
    await nextTick();
    expect(box.scrollTop).toBe(1000);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w web`
Expected: FAIL，三个组件找不到。

- [ ] **Step 3: 写 Composer.vue**

`web/src/components/Composer.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const text = ref('');

function send() {
  const t = text.value;
  if (t.trim().length === 0) return;
  emit('send', t);
  text.value = '';
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
}
</script>

<template>
  <div class="composer">
    <textarea v-model="text" :disabled="disabled" rows="2" placeholder="输入 prompt，Ctrl+Enter 发送" @keydown="onKeydown" />
    <button data-test="send" :disabled="disabled" @click="send">发送</button>
  </div>
</template>

<style scoped>
.composer { display: flex; gap: 8px; padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); background: #1a1a1a; border-top: 1px solid #2a2a2a; }
textarea { flex: 1; resize: none; border-radius: 8px; border: 1px solid #444; background: #111; color: #eee; padding: 8px; font: inherit; font-size: 16px; }
button { padding: 0 16px; border-radius: 8px; border: none; background: #3b82f6; color: #fff; }
button:disabled, textarea:disabled { opacity: 0.5; }
</style>
```

- [ ] **Step 4: 写 QuickKeys.vue**

`web/src/components/QuickKeys.vue`：

```vue
<script setup lang="ts">
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ key: [name: string] }>();
const keys: { name: string; label: string }[] = [
  { name: 'esc', label: 'Esc' }, { name: 'ctrl-c', label: 'Ctrl+C' }, { name: 'tab', label: 'Tab' },
  { name: 'shift-tab', label: 'Shift+Tab' }, { name: 'up', label: '↑' }, { name: 'down', label: '↓' },
  { name: 'left', label: '←' }, { name: 'right', label: '→' }, { name: 'enter', label: 'Enter' },
];
</script>

<template>
  <div class="keys">
    <button v-for="k in keys" :key="k.name" :data-key="k.name" :disabled="disabled" @click="emit('key', k.name)">{{ k.label }}</button>
  </div>
</template>

<style scoped>
.keys { display: flex; gap: 6px; overflow-x: auto; padding: 6px 12px; background: #1a1a1a; }
button { flex: 0 0 auto; padding: 6px 10px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; }
button:disabled { opacity: 0.5; }
</style>
```

- [ ] **Step 5: 写 ChatPane.vue**

`web/src/components/ChatPane.vue`：

```vue
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { ChatMessage } from '../lib/protocol';

const props = defineProps<{ messages: ChatMessage[]; emptyHint: string }>();
const box = ref<HTMLElement | null>(null);
const stick = ref(true);

function onScroll() {
  const el = box.value;
  if (!el) return;
  stick.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
}

watch(() => props.messages.length, async () => {
  await nextTick();
  const el = box.value;
  if (el && stick.value) el.scrollTop = el.scrollHeight;
});

defineExpose({ stick });
</script>

<template>
  <div class="chat" ref="box" @scroll="onScroll">
    <p v-if="messages.length === 0" class="empty">{{ emptyHint }}</p>
    <div v-for="m in messages" :key="m.id" class="msg" :class="[m.role, m.kind]">
      <details v-if="m.kind === 'thinking'">
        <summary>思考</summary>
        <pre>{{ m.text }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_use'">
        <summary>调用 {{ m.tool?.name }}</summary>
        <pre>{{ m.tool?.summary }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_result'">
        <summary>工具结果</summary>
        <pre>{{ m.text }}</pre>
      </details>
      <pre v-else>{{ m.text }}</pre>
    </div>
  </div>
</template>

<style scoped>
.chat { height: 100%; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.msg { max-width: 92%; border-radius: 10px; padding: 8px 10px; background: #1d1d1d; }
.msg.user.text { align-self: flex-end; background: #2b4a8a; }
.msg.assistant.text { align-self: flex-start; }
.msg.thinking, .msg.tool_use, .msg.tool_result { align-self: flex-start; font-size: 13px; color: #bbb; background: #181818; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 15px; }
details pre { font-family: ui-monospace, Consolas, monospace; font-size: 12px; margin-top: 6px; }
summary { cursor: pointer; }
.empty { color: #888; text-align: center; margin-top: 40px; }
</style>
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -w web`
Expected: PASS，新增 Composer 4 个、QuickKeys 1 个、ChatPane 3 个。

- [ ] **Step 7: 提交**

```bash
git add web/src/components/Composer.vue web/src/components/QuickKeys.vue web/src/components/ChatPane.vue web/test/Composer.test.ts web/test/QuickKeys.test.ts web/test/ChatPane.test.ts
git commit -m "feat: prompt 输入框、终端快捷键条与聊天视图"
```

---
### Task 12: 终端画面组件

**Files:**
- Create: `web/src/components/TerminalPane.vue`
- Test: `web/test/TerminalPane.test.ts`

**Interfaces:**
- Consumes: `@xterm/xterm`、`@xterm/addon-fit`
- Produces: `TerminalPane.vue`：props `minCols: number`；emits `input(data: string)`、`resize(cols: number, rows: number)`、`active()`；暴露 `write(data: string)`、`clear()`、`refit()`。

- [ ] **Step 1: 写失败测试**

`web/test/TerminalPane.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const terms: FakeTerm[] = [];
class FakeTerm {
  cols = 100;
  rows = 30;
  written: string[] = [];
  resetCount = 0;
  dataCb: ((d: string) => void) | null = null;
  textarea = document.createElement('textarea');
  constructor() { terms.push(this); }
  loadAddon() {}
  open(el: HTMLElement) { el.appendChild(this.textarea); }
  write(d: string) { this.written.push(d); }
  reset() { this.resetCount += 1; }
  onData(cb: (d: string) => void) { this.dataCb = cb; }
  dispose() {}
}
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerm }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() { const t = terms.at(-1)!; t.cols = 40; t.rows = 20; } } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import TerminalPane from '../src/components/TerminalPane.vue';

describe('TerminalPane', () => {
  it('writes, clears, forwards input and reports active on focus', async () => {
    const w = mount(TerminalPane, { props: { minCols: 80 } });
    const vm = w.vm as unknown as { write: (d: string) => void; clear: () => void };
    vm.write('abc');
    vm.clear();
    const t = terms.at(-1)!;
    expect(t.written).toEqual(['abc']);
    expect(t.resetCount).toBe(1);
    t.dataCb!('x');
    expect(w.emitted('input')).toEqual([['x']]);
    t.textarea.dispatchEvent(new Event('focus'));
    expect(w.emitted('active')).toHaveLength(1);
  });
  it('emits resize after fitting and warns when narrower than minCols', async () => {
    const w = mount(TerminalPane, { props: { minCols: 80 } });
    (w.vm as unknown as { refit: () => void }).refit();
    await w.vm.$nextTick();
    expect(w.emitted('resize')?.at(-1)).toEqual([40, 20]);
    expect(w.text()).toContain('80');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w web -- TerminalPane`
Expected: FAIL，组件找不到。

- [ ] **Step 3: 写 TerminalPane.vue**

`web/src/components/TerminalPane.vue`：

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{ minCols: number }>();
const emit = defineEmits<{ input: [data: string]; resize: [cols: number, rows: number]; active: [] }>();

const host = ref<HTMLElement | null>(null);
const narrow = ref(false);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let observer: ResizeObserver | null = null;

function write(data: string) {
  term?.write(data);
}

function clear() {
  term?.reset();
}

function refit() {
  if (!term || !fit) return;
  fit.fit();
  narrow.value = term.cols < props.minCols;
  emit('resize', term.cols, term.rows);
}

onMounted(() => {
  term = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, Consolas, "Cascadia Mono", monospace',
    cursorBlink: true,
    scrollback: 2000,
    theme: { background: '#111111' },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host.value!);
  term.onData((d) => emit('input', d));
  term.textarea?.addEventListener('focus', () => emit('active'));
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => refit());
    observer.observe(host.value!);
  }
  refit();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  term?.dispose();
  term = null;
});

defineExpose({ write, clear, refit });
</script>

<template>
  <div class="wrap">
    <p v-if="narrow" class="hint">当前宽度不足 {{ minCols }} 列，画面会被压缩，横屏或放大浏览器后更清楚</p>
    <div ref="host" class="term" />
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hint { margin: 0; padding: 6px 12px; font-size: 12px; color: #f0a030; background: #1a1a1a; }
.term { flex: 1; min-height: 0; padding: 4px; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w web -- TerminalPane`
Expected: PASS，2 个用例。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/TerminalPane.vue web/test/TerminalPane.test.ts
git commit -m "feat: 基于 xterm.js 的终端画面组件"
```

---

### Task 13: 会话页组装、前端构建与服务端静态托管验证

**Files:**
- Create: `web/src/pages/SessionView.vue`
- Test: `web/test/SessionView.test.ts`

**Interfaces:**
- Consumes: `StatusBar`、`ChatPane`、`Composer`、`QuickKeys`、`TerminalPane`（Task 10 到 12）、`ReconnectingSocket`/`wsUrl`（Task 9）、`encodeB64`/`decodeB64`、协议类型（Task 9）
- Produces: `SessionView.vue`：props `sessionId: string`。页面行为：
  - 挂载时 `GET /api/sessions/:sid/transcript?limit=200` 作为首屏历史，再连 `/ws?sid=`。
  - `replay` 帧先清空终端再写入；`out` 帧直接写入；`chat` 帧追加消息；`state` 帧更新状态栏；`hook` 帧显示横幅；`error` 帧显示错误。
  - 输入框发送即 `paste` 帧；快捷键即 `key` 帧；终端里直接打字即 `in` 帧；终端尺寸变化即 `resize` 帧；终端获得焦点即 `active` 帧；状态栏"接管回来"即 `attach` 帧。
  - 两个标签：聊天视图默认，终端画面用 `v-show` 保持挂载，切到终端时重新 fit 并发 `active`。

- [ ] **Step 1: 写失败测试**

`web/test/SessionView.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

type Frame = Record<string, unknown>;
const sockets: { frame: ((f: Frame) => void) | null; status: ((s: string) => void) | null; sent: Frame[]; url: string }[] = [];
vi.mock('../src/lib/ws', () => ({
  wsUrl: (p: string) => 'ws://test' + p,
  ReconnectingSocket: class {
    frame: ((f: Frame) => void) | null = null;
    status: ((s: string) => void) | null = null;
    sent: Frame[] = [];
    constructor(public url: string) { sockets.push(this); }
    onFrame(h: (f: Frame) => void) { this.frame = h; }
    onStatus(h: (s: string) => void) { this.status = h; }
    connect() {}
    send(f: Frame) { this.sent.push(f); return true; }
    close() {}
  },
}));

const termWrites: string[] = [];
let termClears = 0;
vi.mock('../src/components/TerminalPane.vue', () => ({
  default: defineComponent({
    name: 'TerminalPane',
    props: { minCols: Number },
    emits: ['input', 'resize', 'active'],
    setup(_p, { expose }) {
      expose({ write: (d: string) => termWrites.push(d), clear: () => { termClears += 1; }, refit: () => {} });
      return () => h('div', { class: 'fake-term' });
    },
  }),
}));

import SessionView from '../src/pages/SessionView.vue';

const history = [{ id: 'u1:0', ts: 1, role: 'user', kind: 'text', text: '历史消息' }];

beforeEach(() => {
  sockets.length = 0;
  termWrites.length = 0;
  termClears = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => history })));
});

describe('SessionView', () => {
  it('loads history, connects to the session socket and appends chat frames', async () => {
    const w = mount(SessionView, { props: { sessionId: 'sid-1' } });
    await flushPromises();
    expect(sockets[0].url).toBe('ws://test/ws?sid=sid-1');
    expect(w.text()).toContain('历史消息');
    sockets[0].frame!({ t: 'chat', messages: [{ id: 'a1:0', ts: 2, role: 'assistant', kind: 'text', text: '回答' }] });
    await flushPromises();
    expect(w.text()).toContain('回答');
  });
  it('sends paste on composer send and key frames from quick keys', async () => {
    const w = mount(SessionView, { props: { sessionId: 'sid-1' } });
    await flushPromises();
    sockets[0].frame!({ t: 'state', attach: 'attached', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: true });
    await flushPromises();
    await w.find('textarea').setValue('你好');
    await w.find('[data-test="send"]').trigger('click');
    expect(sockets[0].sent).toContainEqual({ t: 'paste', text: '你好' });
    await w.find('[data-test="tab-term"]').trigger('click');
    await w.find('[data-key="esc"]').trigger('click');
    expect(sockets[0].sent).toContainEqual({ t: 'key', name: 'esc' });
    expect(sockets[0].sent).toContainEqual({ t: 'active' });
  });
  it('clears before replay, writes output, and sends attach on reattach', async () => {
    const w = mount(SessionView, { props: { sessionId: 'sid-1' } });
    await flushPromises();
    sockets[0].frame!({ t: 'replay', d: 'aGk=' });
    sockets[0].frame!({ t: 'out', d: '5L2g5aW9' });
    expect(termClears).toBe(1);
    expect(termWrites).toEqual(['hi', '你好']);
    sockets[0].frame!({ t: 'state', attach: 'taken_over', reason: '已被本地窗口接管', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: true });
    await flushPromises();
    await w.find('[data-test="reattach"]').trigger('click');
    expect(sockets[0].sent).toContainEqual({ t: 'attach' });
  });
  it('shows hook banners and disables input for read-only sessions', async () => {
    const w = mount(SessionView, { props: { sessionId: 'sid-1' } });
    await flushPromises();
    sockets[0].frame!({ t: 'hook', event: 'PermissionRequest', data: { tool_name: 'Bash' } });
    await flushPromises();
    expect(w.text()).toContain('需要你确认权限');
    sockets[0].frame!({ t: 'state', attach: 'detached', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: false, reason: '只能查看' });
    await flushPromises();
    expect(w.find('textarea').attributes('disabled')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w web -- SessionView`
Expected: FAIL，页面找不到。

- [ ] **Step 3: 写 SessionView.vue**

`web/src/pages/SessionView.vue`：

```vue
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import StatusBar from '../components/StatusBar.vue';
import ChatPane from '../components/ChatPane.vue';
import Composer from '../components/Composer.vue';
import QuickKeys from '../components/QuickKeys.vue';
import TerminalPane from '../components/TerminalPane.vue';
import { ReconnectingSocket, wsUrl, type SocketStatus } from '../lib/ws';
import { decodeB64, encodeB64, type ChatMessage, type StateFrame } from '../lib/protocol';

const props = defineProps<{ sessionId: string }>();
const MIN_COLS = 80;

const tab = ref<'chat' | 'term'>('chat');
const messages = ref<ChatMessage[]>([]);
const state = ref<StateFrame | null>(null);
const socketStatus = ref<SocketStatus>('connecting');
const banner = ref('');
const errorText = ref('');
const term = ref<InstanceType<typeof TerminalPane> | null>(null);
let socket: ReconnectingSocket | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

const canInput = () => !!state.value && state.value.attachable && state.value.attach === 'attached';

function showBanner(text: string, autoHideMs = 0) {
  banner.value = text;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = autoHideMs ? setTimeout(() => { banner.value = ''; }, autoHideMs) : null;
}

function onHook(event: string, data: Record<string, unknown>) {
  if (event === 'PermissionRequest') return showBanner(`需要你确认权限（${String(data.tool_name ?? '')}），切到终端画面处理`);
  if (event === 'Notification') {
    const type = String(data.notification_type ?? '');
    if (type === 'permission_prompt') return showBanner('需要你确认权限，切到终端画面处理');
    if (type === 'idle_prompt') return showBanner('CC 在等你输入');
    return;
  }
  if (event === 'Stop') return showBanner('这轮结束了', 5000);
}

async function loadHistory() {
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/transcript?limit=200`);
    if (r.ok) messages.value = (await r.json()) as ChatMessage[];
  } catch {
    /* 没有历史也能用 */
  }
}

function send(text: string) { socket?.send({ t: 'paste', text }); }
function sendKey(name: string) { socket?.send({ t: 'key', name }); }
function onTermInput(d: string) { socket?.send({ t: 'in', d: encodeB64(d) }); }
function onTermResize(cols: number, rows: number) { socket?.send({ t: 'resize', cols, rows }); }
function onTermActive() { socket?.send({ t: 'active' }); }
function reattach() { socket?.send({ t: 'attach' }); }

async function switchTab(next: 'chat' | 'term') {
  tab.value = next;
  if (next === 'term') {
    await nextTick();
    term.value?.refit();
    onTermActive();
  }
}

onMounted(() => {
  void loadHistory();
  socket = new ReconnectingSocket(wsUrl(`/ws?sid=${encodeURIComponent(props.sessionId)}`));
  socket.onStatus((s) => { socketStatus.value = s; });
  socket.onFrame((f) => {
    switch (f.t) {
      case 'replay': term.value?.clear(); term.value?.write(decodeB64(f.d)); break;
      case 'out': term.value?.write(decodeB64(f.d)); break;
      case 'chat': messages.value = messages.value.concat(f.messages); break;
      case 'state': state.value = f; break;
      case 'hook': onHook(f.event, (f.data ?? {}) as Record<string, unknown>); break;
      case 'error': errorText.value = f.message; break;
      default: break;
    }
  });
  socket.connect();
});

onUnmounted(() => {
  socket?.close();
  if (bannerTimer) clearTimeout(bannerTimer);
});
</script>

<template>
  <div class="page">
    <header>
      <router-link to="/" class="back">‹ 会话</router-link>
      <nav class="tabs">
        <button data-test="tab-chat" :class="{ on: tab === 'chat' }" @click="switchTab('chat')">聊天</button>
        <button v-if="!state || state.attachable" data-test="tab-term" :class="{ on: tab === 'term' }" @click="switchTab('term')">终端</button>
      </nav>
    </header>
    <StatusBar :state="state" :socket="socketStatus" @reattach="reattach" />
    <p v-if="errorText" class="error">{{ errorText }}</p>
    <p v-if="banner" class="banner" @click="banner = ''">{{ banner }}</p>
    <section class="body">
      <ChatPane v-show="tab === 'chat'" :messages="messages" empty-hint="发出第一条 prompt 后这里会显示对话" />
      <div v-show="tab === 'term'" class="termwrap">
        <TerminalPane ref="term" :min-cols="MIN_COLS" @input="onTermInput" @resize="onTermResize" @active="onTermActive" />
        <QuickKeys :disabled="!canInput()" @key="sendKey" />
      </div>
    </section>
    <Composer :disabled="!canInput()" @send="send" />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100%; }
header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #1a1a1a; }
.back { color: #9cc3ff; text-decoration: none; }
.tabs { display: flex; gap: 6px; }
.tabs button { padding: 4px 12px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; }
.tabs button.on { background: #3b82f6; border-color: #3b82f6; }
.body { flex: 1; min-height: 0; }
.termwrap { display: flex; flex-direction: column; height: 100%; }
.error { margin: 0; padding: 8px 12px; color: #ff7b7b; }
.banner { margin: 0; padding: 8px 12px; background: #4a3a10; color: #ffd27a; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -w web`
Expected: 全部 PASS，SessionView 4 个。

- [ ] **Step 5: 构建前端并由服务端托管**

Run：

```bash
npm run build -w web
npm run start -w server
```

Expected: `web/dist/index.html` 生成；服务端启动日志不再提示"网页尚未构建"。另开终端：

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/?t=<token>"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/s/abc?t=<token>"
```

Expected: 两条都是 200（第二条是 SPA 回退到 index.html）。用电脑浏览器打开带 token 的 URL，能看到会话列表；用 `claude --bg --name demo` 起一个会话后列表里出现 demo，点进去终端标签能看到 TUI 画面，聊天标签显示空状态提示。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/SessionView.vue web/test/SessionView.test.ts
git commit -m "feat: 会话页，聊天视图与终端画面可切换，输入经 WebSocket 下发"
```

---
### Task 14: 本地薄客户端

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/attach.ts`
- Modify: `package.json`（根，加 `attach` 脚本）

**Interfaces:**
- Consumes: 服务端 HTTP `/api/sessions`、WebSocket `/ws?sid=`、配置文件里的 `port` 与 `token`（Task 6、Task 7）
- Produces: 命令 `npm run attach -- <短id或会话名>`。stdin 原样转发为 `in` 帧，`out`/`replay` 帧写到 stdout，终端尺寸变化发 `resize` 帧，启动时发 `active` 帧，Ctrl+] 退出且不影响监测器与会话。

这个客户端没有单元测试：它是几十行的管道代码，行为靠 Step 4 的手动验证覆盖。

- [ ] **Step 1: 写 cli/package.json 与 tsconfig**

`cli/package.json`：

```json
{
  "name": "@cc-monitor/cli",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "attach": "tsx src/attach.ts"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

`cli/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

根 `package.json` 的 `scripts` 里加一行：

```json
"attach": "npm run attach -w cli --"
```

- [ ] **Step 2: 写 attach.ts**

`cli/src/attach.ts`：

```ts
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

interface SessionInfo { sessionId: string; name: string; jobId?: string; attachable: boolean }
type ServerFrame =
  | { t: 'replay'; d: string } | { t: 'out'; d: string } | { t: 'error'; message: string }
  | { t: 'state'; attach: string; reason?: string } | { t: string };

const target = process.argv[2];
if (!target) {
  console.error('用法: npm run attach -- <短id或会话名>');
  process.exit(2);
}

const localAppData = process.env.LOCALAPPDATA && process.env.LOCALAPPDATA.length > 0
  ? process.env.LOCALAPPDATA
  : join(homedir(), 'AppData', 'Local');
const cfgPath = join(localAppData, 'cc-monitor', 'config.json');
let cfg: { port?: number; token?: string };
try {
  cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { port?: number; token?: string };
} catch {
  console.error(`读不到 ${cfgPath}，先启动一次监测器再试`);
  process.exit(1);
}
if (!cfg.token) {
  console.error('配置文件里没有 token');
  process.exit(1);
}
const port = Number(process.env.CCM_PORT) || cfg.port || 8787;
const headers = { cookie: `ccm=${cfg.token}` };

const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers });
if (!res.ok) {
  console.error(`监测器没有响应（HTTP ${res.status}），它在运行吗？`);
  process.exit(1);
}
const sessions = (await res.json()) as SessionInfo[];
const info = sessions.find((s) => s.attachable && (s.jobId === target || s.name === target));
if (!info) {
  const available = sessions.filter((s) => s.attachable).map((s) => `${s.jobId}  ${s.name}`).join('\n  ');
  console.error(`没有名为 ${target} 的后台会话。当前可用：\n  ${available || '（无）'}`);
  process.exit(1);
}

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${encodeURIComponent(info.sessionId)}`, { headers });

function sendResize(): void {
  ws.send(JSON.stringify({ t: 'resize', cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 }));
}

function restoreTty(): void {
  try { process.stdin.setRawMode(false); } catch { /* 非 TTY */ }
}

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'active' }));
  sendResize();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stderr.write('[cc-monitor] 已连接，Ctrl+] 退出\r\n');
});

ws.on('message', (raw) => {
  const f = JSON.parse(raw.toString()) as ServerFrame;
  if (f.t === 'out' || f.t === 'replay') {
    process.stdout.write(Buffer.from((f as { d: string }).d, 'base64').toString('utf8'));
  } else if (f.t === 'state') {
    const s = f as { attach: string; reason?: string };
    if (s.attach !== 'attached') process.stderr.write(`\r\n[cc-monitor] ${s.reason ?? s.attach}\r\n`);
  } else if (f.t === 'error') {
    console.error((f as { message: string }).message);
    process.exit(1);
  }
});

ws.on('close', () => {
  restoreTty();
  process.stderr.write('\r\n[cc-monitor] 连接已关闭\r\n');
  process.exit(0);
});

ws.on('error', (e) => {
  restoreTty();
  console.error(`[cc-monitor] 连接失败：${e.message}`);
  process.exit(1);
});

process.stdin.on('data', (buf: Buffer) => {
  if (buf.length === 1 && buf[0] === 0x1d) { // Ctrl+]
    restoreTty();
    ws.close();
    return;
  }
  ws.send(JSON.stringify({ t: 'in', d: buf.toString('base64') }));
});

process.stdout.on('resize', sendResize);
```

- [ ] **Step 3: 安装依赖**

Run: `npm install`
Expected: 成功。

- [ ] **Step 4: 手动验证**

前提：监测器在运行，且有一个 `claude --bg --name demo` 的会话。在 Windows Terminal 里：

```bash
npm run attach -- demo
```

Expected: 终端里出现 CC 的 TUI 画面；打字能看到输入框回显；手机或电脑浏览器同时打开同一会话的终端标签，两边画面一致、两边都能输入；拖动 Windows Terminal 窗口大小，画面跟着重排；按 Ctrl+] 回到 shell，浏览器那边不受影响。再直接运行 `claude attach <短id>`，浏览器状态栏应显示"已被本地窗口接管"，点"接管回来"后浏览器恢复、本地 `claude attach` 退出并打印 Session opened in another window。

- [ ] **Step 5: 提交**

```bash
git add cli/package.json cli/tsconfig.json cli/src/attach.ts package.json package-lock.json
git commit -m "feat: 本地薄客户端，经监测器在终端里查看和操作会话"
```

---

### Task 15: README、防火墙说明与手机验收

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 全部前序任务的命令与行为
- Produces: 面向使用者的完整说明；验收清单跑通即为完成。

- [ ] **Step 1: 补全 README**

把 `README.md` 改为：

```markdown
# cc-monitor

局域网内用手机查看并操控本机的 Claude Code 会话：聊天视图读回答，终端画面看原样，输入框发 prompt。所有流量只在局域网内。

## 要求

- Windows 10 / 11，Node.js 24 或更新。
- 已安装并登录 Claude Code（npm 方式安装，`claude --version` 能运行）。
- 要操控的会话必须用 `claude --bg` 启动。普通方式启动的会话只能查看状态和对话，不能输入。

## 安装

    npm install
    npm run build -w web

## 启动

    npm start

启动后终端会打印一个带访问口令的地址和二维码，手机扫码即可打开。口令保存在 `%LOCALAPPDATA%\cc-monitor\config.json`，不要外泄：拿到它就等于拿到你这台电脑的终端。

第一次使用需要放行防火墙端口，在管理员 PowerShell 里执行：

    netsh advfirewall firewall add rule name="cc-monitor" dir=in action=allow protocol=TCP localport=8787

## 使用

1. 在项目目录里启动会话：`claude --bg --name 项目名`。
2. 手机打开监测器，列表里点进这个会话。
3. 聊天标签读对话，底部输入框发 prompt；需要确认权限、按 Esc 或用斜杠命令时切到终端标签。
4. 在电脑上看同一个会话，用 `npm run attach -- 项目名`，Ctrl+] 退出。不要直接 `claude attach`，那会把监测器踢下线；真踢了，手机上点"接管回来"即可。

## 手机提醒

把启动日志里打印的 hooks 片段合并进 `%USERPROFILE%\.claude\settings.json`，之后 CC 等你确认权限或一轮结束时，手机页面会出现横幅。监测器不会替你改这个文件。

## 配置

`config.json` 可选字段：`port`（默认 8787）、`bind`（默认 0.0.0.0）、`minCols`（默认 80）、`minRows`（默认 24）、`idleDetachMinutes`（默认 10）、`ringBufferKB`（默认 512）、`claudeExe`（默认自动查找）。环境变量 `CCM_PORT`、`CCM_BIND` 优先级更高。

## 排查

- 页面提示"已被本地窗口接管"：有人在电脑上直接运行了 `claude attach`，点"接管回来"。
- 提示找不到 claude.exe：在 `config.json` 里把 `claudeExe` 设为 Claude Code 原生二进制的完整路径。
- 手机竖屏画面被压缩：终端标签至少需要 80 列，横屏或在聊天标签里阅读。
- 聊天视图提示转录格式可能已变化：Claude Code 升级改了转录格式，终端标签不受影响。

## 开发

    npm test                 # 全部单元测试
    npm run dev:server       # 服务端热重载
    npm run dev:web          # 前端开发服务器，代理到 8787
    npm run it:attach -w server   # 真实会话集成验证，会起一个 ccm-it 会话并自动清理
```

- [ ] **Step 2: 跑全部测试与构建**

Run：

```bash
npm test
npm run build
```

Expected: server 与 web 的测试全部 PASS；`web/dist` 与 `server/dist` 生成；`vue-tsc` 与 `tsc` 无类型错误。

- [ ] **Step 3: 手机验收**

前提：手机和电脑在同一局域网，防火墙已放行，监测器用 `npm start` 启动，用 `claude --bg --name demo` 起了一个会话。按顺序验证，每条都要实际看到：

1. 手机扫码打开，列表里有 demo，状态显示空闲。
2. 点进 demo，聊天标签显示空状态提示；状态栏显示"已连接"。
3. 切终端标签，看到 TUI 画面；竖屏时出现宽度不足提示；横屏后提示消失。
4. 回聊天标签，输入框发送"用一句话介绍你自己"，终端标签能看到 prompt 被提交，几秒后聊天标签出现回答，状态栏在生成期间显示忙碌。
5. 终端标签按 Esc 与方向键，画面有相应反应。
6. 在电脑上 `npm run attach -- demo`，两边画面一致、两边都能打字。
7. 电脑上直接 `claude attach <短id>`，手机状态栏变成"已被本地窗口接管"；点"接管回来"，手机恢复。
8. 手机关掉 Wi-Fi 再打开，状态栏先显示"网络断开，重连中"，随后自动恢复且画面完整。
9. 配置了 hooks 后，发一条会触发工具调用的 prompt，一轮结束时手机出现"这轮结束了"横幅。
10. `claude stop <短id>` 后，手机列表里 demo 消失。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: 使用说明、防火墙与排查指引"
```
