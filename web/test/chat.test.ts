import { describe, it, expect } from 'vitest';
import { mergeMessages } from '../src/lib/chat';
import type { ChatMessage } from '../src/lib/protocol';

const m = (id: string, ts: number): ChatMessage => ({ id, ts, role: 'user', kind: 'text', text: id });

describe('mergeMessages', () => {
  it('unions by id, keeps time order, and never duplicates', () => {
    const merged = mergeMessages([m('a', 1), m('b', 2)], [m('b', 2), m('c', 3)]);
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('places older messages fetched later before newer live ones', () => {
    const merged = mergeMessages([m('live', 10)], [m('old1', 1), m('old2', 2)]);
    expect(merged.map((x) => x.id)).toEqual(['old1', 'old2', 'live']);
  });
  it('is stable for equal timestamps', () => {
    const merged = mergeMessages([m('x:0', 5), m('x:1', 5)], [m('x:2', 5)]);
    expect(merged.map((x) => x.id)).toEqual(['x:0', 'x:1', 'x:2']);
  });
});
