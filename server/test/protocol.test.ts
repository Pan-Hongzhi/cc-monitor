import { describe, it, expect } from 'vitest';
import { encodeB64, decodeB64 } from '../src/protocol.js';

describe('base64 helpers', () => {
  it('round-trips UTF-8 text including Chinese and escape bytes', () => {
    const s = '\x1b[200~你好\n世界\x1b[201~';
    expect(decodeB64(encodeB64(s))).toBe(s);
  });
  it('encodes to standard base64', () => {
    expect(encodeB64('hi')).toBe('aGk=');
  });
});
