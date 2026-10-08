import { execFile } from 'node:child_process';

export type ClaudeRunner = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** 以参数数组方式调用 claude 命令行，不经过 shell 拼接 */
export const defaultRunner: ClaudeRunner = (args) =>
  new Promise((resolve) => {
    execFile('cmd.exe', ['/c', 'claude', ...args], { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: `${stdout ?? ''}${stderr ?? ''}` });
    });
  });

export async function stopSession(jobId: string, run: ClaudeRunner = defaultRunner): Promise<{ ok: boolean; output: string }> {
  if (!/^[0-9a-f]{8}$/.test(jobId)) return { ok: false, output: '无效的会话 id' };
  const r = await run(['stop', jobId]);
  return { ok: r.code === 0, output: r.stdout.trim() };
}
