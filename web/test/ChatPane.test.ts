import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ChatPane from '../src/components/ChatPane.vue';

const msgs = [
  { id: 'u1:0', ts: 1, role: 'user', kind: 'text', text: '帮我看看' },
  { id: 'a1:0', ts: 2, role: 'assistant', kind: 'thinking', text: '想一下' },
  { id: 'a2:0', ts: 3, role: 'assistant', kind: 'tool_use', text: '', tool: { name: 'Bash', summary: '{"command":"ls"}' } },
  { id: 'u2:0', ts: 4, role: 'user', kind: 'tool_result', text: 'total 8' },
  { id: 'a3:0', ts: 5, role: 'assistant', kind: 'text', text: '目录里有 8 个文件' },
] as const;

describe('ChatPane', () => {
  it('renders each kind with its own class and collapses thinking and tools', () => {
    const w = mount(ChatPane, { props: { messages: [...msgs], emptyHint: '空' } });
    expect(w.findAll('.msg').length).toBe(5);
    expect(w.find('.msg.user.text').text()).toContain('帮我看看');
    expect(w.find('.msg.assistant.thinking details').exists()).toBe(true);
    expect(w.find('.msg.tool_use summary').text()).toContain('Bash');
    expect(w.find('.msg.tool_result').text()).toContain('total 8');
  });
  it('uses Claude Code transcript markers', () => {
    const w = mount(ChatPane, { props: { messages: [...msgs], emptyHint: '空' } });
    expect(w.find('.msg.user.text .marker').text()).toBe('>');
    expect(w.find('.msg.assistant.text .marker').text()).toBe('⏺');
    expect(w.find('.msg.tool_use summary').text()).toContain('Bash(ls)');
    expect(w.find('.msg.tool_result summary .marker').text()).toBe('⎿');
    expect(w.find('.msg.thinking summary').text()).toContain('Thinking');
  });
  it('shows only the first lines of a long tool result until expanded', () => {
    const long = { id: 'u9:0', ts: 9, role: 'user', kind: 'tool_result', text: 'l1\nl2\nl3\nl4\nl5\nl6' } as const;
    const w = mount(ChatPane, { props: { messages: [long], emptyHint: '' } });
    const summary = w.find('.msg.tool_result summary');
    expect(summary.text()).toContain('l3');
    expect(summary.text()).not.toContain('l4');
    expect(summary.text()).toContain('+3 行');
    expect(w.find('.msg.tool_result .rest').text()).toContain('l6');
  });
  it('shows the empty hint without messages', () => {
    const w = mount(ChatPane, { props: { messages: [], emptyHint: '发出第一条 prompt 后这里会显示对话' } });
    expect(w.text()).toContain('发出第一条 prompt 后这里会显示对话');
  });
  it('stops sticking to the bottom when the user scrolls up, and sticks again at the bottom', async () => {
    const w = mount(ChatPane, { props: { messages: [...msgs], emptyHint: '' } });
    const box = w.find('.chat').element as HTMLElement;
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
    box.scrollTop = 100;
    await w.find('.chat').trigger('scroll');
    expect((w.vm as unknown as { stick: boolean }).stick).toBe(false);
    box.scrollTop = 700;
    await w.find('.chat').trigger('scroll');
    expect((w.vm as unknown as { stick: boolean }).stick).toBe(true);
    await w.setProps({ messages: [...msgs, { id: 'a4:0', ts: 6, role: 'assistant', kind: 'text', text: '新消息' }] });
    await nextTick();
    expect(box.scrollTop).toBe(1000);
  });
});
