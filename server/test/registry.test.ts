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
