import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/ringbuffer.js';

describe('RingBuffer', () => {
  it('keeps everything under capacity in order', () => {
    const rb = new RingBuffer(10);
    rb.push('abc'); rb.push('def');
    expect(rb.toString()).toBe('abcdef');
    expect(rb.length).toBe(6);
  });
  it('drops oldest content when over capacity', () => {
    const rb = new RingBuffer(5);
    rb.push('abc'); rb.push('defg');
    expect(rb.toString()).toBe('cdefg');
    expect(rb.length).toBe(5);
  });
  it('handles a single chunk larger than capacity', () => {
    const rb = new RingBuffer(3);
    rb.push('abcdefgh');
    expect(rb.toString()).toBe('fgh');
  });
  it('tail returns the last n code units', () => {
    const rb = new RingBuffer(100);
    rb.push('Session opened in another window');
    expect(rb.tail(6)).toBe('window');
    expect(rb.tail(1000)).toBe('Session opened in another window');
  });
  it('clear empties the buffer', () => {
    const rb = new RingBuffer(10);
    rb.push('abc'); rb.clear();
    expect(rb.toString()).toBe('');
    expect(rb.length).toBe(0);
  });
});
