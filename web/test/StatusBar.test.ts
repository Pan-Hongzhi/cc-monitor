import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBar from '../src/components/StatusBar.vue';

const base = { t: 'state', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: true } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('StatusBar', () => {
  it('shows attached + busy', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'attached', status: 'busy' }, socket: 'open' } });
    expect(w.text()).toContain('已连接');
    expect(w.text()).toContain('忙碌');
    expect(w.find('[data-test="reattach"]').exists()).toBe(false);
  });
  it('offers reattach when taken over and emits the event', async () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'taken_over', reason: '已被本地窗口接管' }, socket: 'open' } });
    expect(w.text()).toContain('已被本地窗口接管');
    await w.find('[data-test="reattach"]').trigger('click');
    expect(w.emitted('reattach')).toHaveLength(1);
  });
  it('shows the error reason and reattach for errors', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'error', reason: 'attach 进程退出，退出码 1：daemon not running' }, socket: 'open' } });
    expect(w.text()).toContain('daemon not running');
    expect(w.find('[data-test="reattach"]').exists()).toBe(true);
  });
  it('marks read-only sessions without a reattach button', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'detached', attachable: false, reason: '这个会话不是用 claude --bg 启动的，只能查看，不能输入' }, socket: 'open' } });
    expect(w.text()).toContain('只能查看');
    expect(w.find('[data-test="reattach"]').exists()).toBe(false);
  });
  it('shows reconnecting when the socket is closed and a format warning when unknown records pile up', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'attached', unknownRecords: 500 }, socket: 'closed' } });
    expect(w.text()).toContain('重连中');
    expect(w.text()).toContain('转录格式可能已变化');
  });
  it('asks for a second tap before emitting stop, and forgets the first tap after a while', async () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'attached' }, socket: 'open', stoppable: true } });
    const btn = w.find('[data-test="stop"]');
    expect(btn.text()).toContain('停止会话');
    await btn.trigger('click');
    expect(w.emitted('stop')).toBeUndefined();
    expect(w.find('[data-test="stop"]').text()).toContain('确认');
    await w.find('[data-test="stop"]').trigger('click');
    expect(w.emitted('stop')).toHaveLength(1);
    const w2 = mount(StatusBar, { props: { state: { ...base, attach: 'attached' }, socket: 'open', stoppable: true } });
    await w2.find('[data-test="stop"]').trigger('click');
    await vi.advanceTimersByTimeAsync(5000);
    expect(w2.find('[data-test="stop"]').text()).not.toContain('确认');
  });
  it('hides the stop button when the session cannot be stopped', () => {
    const w = mount(StatusBar, { props: { state: { ...base, attach: 'attached' }, socket: 'open', stoppable: false } });
    expect(w.find('[data-test="stop"]').exists()).toBe(false);
  });
});
