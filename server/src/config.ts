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
    minCols: num(file.minCols, 40), // 手机约 50 列；电脑客户端活跃时会自然变宽
    minRows: num(file.minRows, 24),
    idleDetachMinutes: num(file.idleDetachMinutes, 10),
    ringBufferKB: num(file.ringBufferKB, 512),
    claudeExe,
  };
}
