import { describe, it, expect } from 'vitest';
import { stopSession, type ClaudeRunner } from '../src/control.js';

function fakeRunner(code: number, stdout: string) {
  const calls: string[][] = [];
  const run: ClaudeRunner = async (args) => { calls.push(args); return { code, stdout }; };
  return { run, calls };
}

describe('stopSession', () => {
  it('runs claude stop with the job id and reports success', async () => {
    const { run, calls } = fakeRunner(0, 'stopped 49fbe6a0\n');
    const r = await stopSession('49fbe6a0', run);
    expect(calls).toEqual([['stop', '49fbe6a0']]);
    expect(r).toEqual({ ok: true, output: 'stopped 49fbe6a0' });
  });
  it('reports failure when claude exits non-zero', async () => {
    const { run } = fakeRunner(1, 'no such session');
    const r = await stopSession('49fbe6a0', run);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('no such session');
  });
  it('refuses ids that are not an 8-char hex job id without running anything', async () => {
    const { run, calls } = fakeRunner(0, '');
    const r = await stopSession('../x; rm', run);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
