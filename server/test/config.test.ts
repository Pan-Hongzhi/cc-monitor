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
    expect(first.minCols).toBe(40); // 手机约 50 列，让会话按手机宽度排版
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
