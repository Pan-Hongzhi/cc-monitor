import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// vi.mock 会被提升到文件顶部，工厂里引用的对象必须用 vi.hoisted 定义
const { terms, FakeTerm } = vi.hoisted(() => {
  class FakeTerm {
    cols = 100;
    rows = 30;
    written: string[] = [];
    resetCount = 0;
    dataCb: ((d: string) => void) | null = null;
    textarea = document.createElement('textarea');
    constructor() { terms.push(this); }
    loadAddon() {}
    open(el: HTMLElement) { el.appendChild(this.textarea); }
    write(d: string) { this.written.push(d); }
    reset() { this.resetCount += 1; }
    onData(cb: (d: string) => void) { this.dataCb = cb; }
    dispose() {}
  }
  const terms: FakeTerm[] = [];
  return { terms, FakeTerm };
});
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerm }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() { const t = terms.at(-1)!; t.cols = 40; t.rows = 20; } } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import TerminalPane from '../src/components/TerminalPane.vue';

describe('TerminalPane', () => {
  it('writes, clears, forwards input and reports active on focus', async () => {
    const w = mount(TerminalPane, { props: { minCols: 80 } });
    const vm = w.vm as unknown as { write: (d: string) => void; clear: () => void };
    vm.write('abc');
    vm.clear();
    const t = terms.at(-1)!;
    expect(t.written).toEqual(['abc']);
    expect(t.resetCount).toBe(1);
    t.dataCb!('x');
    expect(w.emitted('input')).toEqual([['x']]);
    t.textarea.dispatchEvent(new Event('focus'));
    expect(w.emitted('active')).toHaveLength(1);
  });
  it('emits resize after fitting and warns when narrower than minCols', async () => {
    const w = mount(TerminalPane, { props: { minCols: 80 } });
    (w.vm as unknown as { refit: () => void }).refit();
    await w.vm.$nextTick();
    expect(w.emitted('resize')?.at(-1)).toEqual([40, 20]);
    expect(w.text()).toContain('80');
  });
});
