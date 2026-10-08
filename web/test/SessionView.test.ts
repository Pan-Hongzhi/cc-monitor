import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

type Frame = Record<string, unknown>;
const sockets: { frame: ((f: Frame) => void) | null; status: ((s: string) => void) | null; sent: Frame[]; url: string; sendOk: boolean }[] = [];
vi.mock('../src/lib/ws', () => ({
  wsUrl: (p: string) => 'ws://test' + p,
  ReconnectingSocket: class {
    frame: ((f: Frame) => void) | null = null;
    status: ((s: string) => void) | null = null;
    sent: Frame[] = [];
    sendOk = true;
    constructor(public url: string) { sockets.push(this); }
    onFrame(h: (f: Frame) => void) { this.frame = h; }
    onStatus(h: (s: string) => void) { this.status = h; }
    connect() {}
    send(f: Frame) { this.sent.push(f); return this.sendOk; }
    close() {}
  },
}));

const termWrites: string[] = [];
let termClears = 0;
vi.mock('../src/components/TerminalPane.vue', () => ({
  default: defineComponent({
    name: 'TerminalPane',
    props: { minCols: Number },
    emits: ['input', 'resize', 'active'],
    setup(_p, { expose }) {
      expose({ write: (d: string) => termWrites.push(d), clear: () => { termClears += 1; }, refit: () => {} });
      return () => h('div', { class: 'fake-term' });
    },
  }),
}));

import SessionView from '../src/pages/SessionView.vue';

const history = [{ id: 'u1:0', ts: 1, role: 'user', kind: 'text', text: '历史消息' }];
const attached = { t: 'state', attach: 'attached', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: true };
const mountOptions = { props: { sessionId: 'sid-1' }, global: { stubs: { 'router-link': true } } };
const posts: { url: string; init?: RequestInit }[] = [];
let stopOk = true;

beforeEach(() => {
  sockets.length = 0;
  termWrites.length = 0;
  termClears = 0;
  posts.length = 0;
  stopOk = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ url, init });
      return { ok: stopOk, status: stopOk ? 200 : 502, json: async () => ({ ok: stopOk, output: stopOk ? 'stopped' : 'boom' }), text: async () => 'boom' };
    }
    return { ok: true, json: async () => history };
  }));
});

describe('SessionView', () => {
  it('loads history, connects to the session socket and appends chat frames without duplicates', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    expect(sockets[0].url).toBe('ws://test/ws?sid=sid-1');
    expect(w.text()).toContain('历史消息');
    sockets[0].frame!({ t: 'chat', messages: [{ id: 'a1:0', ts: 2, role: 'assistant', kind: 'text', text: '回答' }] });
    sockets[0].frame!({ t: 'chat', messages: [{ id: 'a1:0', ts: 2, role: 'assistant', kind: 'text', text: '回答' }] });
    await flushPromises();
    expect(w.text()).toContain('回答');
    expect(w.findAll('.msg').length).toBe(2);
  });
  it('sends paste on composer send and key frames from quick keys', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].status!('open');
    sockets[0].frame!(attached);
    await flushPromises();
    await w.find('textarea').setValue('你好');
    await w.find('[data-test="send"]').trigger('click');
    expect(sockets[0].sent).toContainEqual({ t: 'paste', text: '你好' });
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('');
    await w.find('[data-test="tab-term"]').trigger('click');
    await w.find('[data-key="esc"]').trigger('click');
    expect(sockets[0].sent).toContainEqual({ t: 'key', name: 'esc' });
    expect(sockets[0].sent).toContainEqual({ t: 'active' });
  });
  it('keeps the prompt and warns when the socket cannot send, and disables input while disconnected', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].status!('open');
    sockets[0].frame!(attached);
    await flushPromises();
    sockets[0].sendOk = false;
    await w.find('textarea').setValue('辛苦打的一段话');
    await w.find('[data-test="send"]').trigger('click');
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('辛苦打的一段话');
    expect(w.text()).toContain('内容已保留');
    sockets[0].status!('closed');
    await flushPromises();
    expect(w.find('textarea').attributes('disabled')).toBeDefined();
  });
  it('reloads history after a reconnect and merges by id', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].status!('open');
    await flushPromises();
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    sockets[0].frame!({ t: 'chat', messages: [{ id: 'a1:0', ts: 2, role: 'assistant', kind: 'text', text: '断线前的回答' }] });
    sockets[0].status!('closed');
    sockets[0].status!('open');
    await flushPromises();
    expect(vi.mocked(fetch).mock.calls.length).toBe(2);
    expect(w.findAll('.msg').length).toBe(2);
    expect(w.text()).toContain('历史消息');
    expect(w.text()).toContain('断线前的回答');
  });
  it('clears before replay, writes output, and sends attach on reattach', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].frame!({ t: 'replay', d: 'aGk=' });
    sockets[0].frame!({ t: 'out', d: '5L2g5aW9' });
    expect(termClears).toBe(1);
    expect(termWrites).toEqual(['hi', '你好']);
    sockets[0].frame!({ t: 'state', attach: 'taken_over', reason: '已被本地窗口接管', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: true });
    await flushPromises();
    await w.find('[data-test="reattach"]').trigger('click');
    expect(sockets[0].sent).toContainEqual({ t: 'attach' });
  });
  it('shows hook banners and disables input for read-only sessions', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].frame!({ t: 'hook', event: 'PermissionRequest', data: { tool_name: 'Bash' } });
    await flushPromises();
    expect(w.text()).toContain('需要你确认权限');
    sockets[0].frame!({ t: 'state', attach: 'detached', status: 'idle', size: { cols: 80, rows: 24 }, unknownRecords: 0, attachable: false, reason: '只能查看' });
    await flushPromises();
    expect(w.find('textarea').attributes('disabled')).toBeDefined();
    expect(w.find('[data-test="stop"]').exists()).toBe(false);
  });
  it('stops the session through the API after the second tap and tells the user', async () => {
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].status!('open');
    sockets[0].frame!(attached);
    await flushPromises();
    await w.find('[data-test="stop"]').trigger('click');
    expect(posts.length).toBe(0);
    await w.find('[data-test="stop"]').trigger('click');
    await flushPromises();
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe('/api/sessions/sid-1/stop');
    expect(w.text()).toContain('会话已停止');
    expect(w.find('[data-test="stop"]').exists()).toBe(false);
  });
  it('reports a failed stop without hiding the button', async () => {
    stopOk = false;
    const w = mount(SessionView, mountOptions);
    await flushPromises();
    sockets[0].status!('open');
    sockets[0].frame!(attached);
    await flushPromises();
    await w.find('[data-test="stop"]').trigger('click');
    await w.find('[data-test="stop"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('停止失败');
    expect(w.find('[data-test="stop"]').exists()).toBe(true);
  });
});
