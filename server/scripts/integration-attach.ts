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

  // 单行 ASCII：确认括号粘贴原样到达输入框
  const marker = 'ccm-it-paste-' + Date.now().toString(36);
  session.writeInput(composePaste(marker));
  await sleep(2500);
  let logs = stripAnsi(await claude('logs', id));
  check('括号粘贴的文字出现在输入框', logs.includes(marker));
  session.writeInput('\x7f'.repeat(marker.length));
  await sleep(500);

  // 两行中文：这是手机上最常见的输入，必须不乱码、不被当成两次提交
  const suffix = Date.now().toString(36);
  const line1 = '中文甲' + suffix;
  const line2 = '中文乙' + suffix;
  session.writeInput(composePaste(line1 + '\n' + line2));
  await sleep(2500);
  logs = stripAnsi(await claude('logs', id));
  const bothLines = logs.includes(line1) && logs.includes(line2);
  const placeholder = /Pasted text/i.test(logs);
  check('两行中文括号粘贴到达输入框', bothLines || placeholder, bothLines ? '两行原文可见' : placeholder ? '显示为多行粘贴占位' : '两行都没找到');
  check('输入框里没有乱码', !logs.includes('�'));
  check('没有被当成提交（画面上没有出现助手回复）', !/esc to interrupt/i.test(logs));
  session.writeInput('\x7f'.repeat(line1.length + line2.length + 2));
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
