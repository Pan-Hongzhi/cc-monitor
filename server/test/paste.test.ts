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
