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
