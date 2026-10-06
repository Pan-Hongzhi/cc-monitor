import { describe, it, expect } from 'vitest';
import { toolLabel, splitLines } from '../src/lib/transcriptStyle';

describe('toolLabel', () => {
  it('shows the most telling argument like Claude Code does', () => {
    expect(toolLabel('Bash', '{"command":"ls -la"}')).toBe('Bash(ls -la)');
    expect(toolLabel('Read', '{"file_path":"C:/a.ts","limit":10}')).toBe('Read(C:/a.ts)');
    expect(toolLabel('Write', '{"file_path":"a.ts","content":"xxx"}')).toBe('Write(a.ts)');
    expect(toolLabel('Skill', '{"skill":"superpowers:brainstorming"}')).toBe('Skill(superpowers:brainstorming)');
    expect(toolLabel('Agent', '{"description":"Review code","prompt":"long prompt"}')).toBe('Agent(Review code)');
  });
  it('falls back to the raw summary when there is no string argument or it is not JSON', () => {
    expect(toolLabel('X', '{"a":1}')).toBe('X({"a":1})');
    expect(toolLabel('X', 'not json')).toBe('X(not json)');
    expect(toolLabel('X', '')).toBe('X()');
  });
  it('keeps the label on one short line', () => {
    const label = toolLabel('Bash', JSON.stringify({ command: 'x'.repeat(200) }));
    expect(label.length).toBeLessThanOrEqual('Bash()'.length + 81);
    expect(label.endsWith('…)')).toBe(true);
    expect(toolLabel('Bash', '{"command":"a\\nb"}')).toBe('Bash(a b)');
  });
});

describe('splitLines', () => {
  it('splits a long result into a visible head and a hidden rest', () => {
    expect(splitLines('a\nb\nc\nd\ne', 3)).toEqual({ head: 'a\nb\nc', rest: 'd\ne', hidden: 2 });
  });
  it('hides nothing for short results', () => {
    expect(splitLines('a', 3)).toEqual({ head: 'a', rest: '', hidden: 0 });
    expect(splitLines('a\nb\nc', 3)).toEqual({ head: 'a\nb\nc', rest: '', hidden: 0 });
  });
});
