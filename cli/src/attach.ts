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

function sendFrame(frame: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function sendResize(): void {
  sendFrame({ t: 'resize', cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
}

function setRaw(on: boolean): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(on); // 非终端（管道）下没有 raw 模式
}

function onStdin(buf: Buffer): void {
  if (buf.length === 1 && buf[0] === 0x1d) { // Ctrl+]
    setRaw(false);
    ws.close();
    return;
  }
  sendFrame({ t: 'in', d: buf.toString('base64') });
}

ws.on('open', () => {
  sendFrame({ t: 'active' });
  sendResize();
  setRaw(true);
  process.stdin.on('data', onStdin); // 连接建立后才开始读键盘，避免把按键发给未打开的连接
  process.stdin.resume();
  process.stdout.on('resize', sendResize);
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
  setRaw(false);
  process.stderr.write('\r\n[cc-monitor] 连接已关闭\r\n');
  process.exit(0);
});

ws.on('error', (e) => {
  setRaw(false);
  console.error(`[cc-monitor] 连接失败：${e.message}`);
  process.exit(1);
});
