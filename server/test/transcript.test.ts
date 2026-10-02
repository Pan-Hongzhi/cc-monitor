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
  it('ignores other record types, counts malformed user/assistant records and failed lines', () => {
    const s = fresh();
    expect(parseTranscriptLine(snapshot, s)).toEqual([]);
    expect(parseTranscriptLine('{not json', s)).toEqual([]);
    expect(parseTranscriptLine(line({ type: 'assistant', uuid: 'a6' }), s)).toEqual([]);
    expect(s).toEqual({ unknown: 1, failed: 1 });
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
