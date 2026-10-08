import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';

const sockets: { frame: ((f: unknown) => void) | null; closed: boolean }[] = [];
vi.mock('../src/lib/ws', () => ({
  wsUrl: (p: string) => 'ws://test' + p,
  ReconnectingSocket: class {
    frame: ((f: unknown) => void) | null = null;
    closed = false;
    constructor() { sockets.push(this); }
    onFrame(h: (f: unknown) => void) { this.frame = h; }
    onStatus() {}
    connect() {}
    send() { return true; }
    close() { this.closed = true; }
  },
}));

import SessionList from '../src/pages/SessionList.vue';

const list = [
  { sessionId: 's1', pid: 1, cwd: 'C:/p/one', name: 'one', kind: 'bg', jobId: 'aaaaaaaa', status: 'busy', startedAt: 2, attachable: true },
  { sessionId: 's2', pid: 2, cwd: 'C:/p/two', name: 'two', kind: 'interactive', status: 'idle', startedAt: 1, attachable: false },
];

function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: SessionList }, { path: '/s/:sessionId', component: { template: '<div />' } }] });
  return mount(SessionList, { global: { plugins: [router] } });
}

beforeEach(() => { sockets.length = 0; });

describe('SessionList', () => {
  it('renders sessions from the API with status and read-only badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));
    const w = mountPage();
    await flushPromises();
    const rows = w.findAll('[data-test="session"]');
    expect(rows.length).toBe(2);
    expect(rows[0].text()).toContain('one');
    expect(rows[0].text()).toContain('忙碌');
    expect(rows[1].text()).toContain('只读');
    expect(rows[0].find('a').attributes('href')).toBe('/s/s1');
  });
  it('draws the logo as an SVG so phones without block glyphs render it the same', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));
    const w = mountPage();
    await flushPromises();
    expect(w.find('svg.logo').exists()).toBe(true);
    expect(w.find('pre.logo').exists()).toBe(false);
  });
  it('updates from the sessions frame and shows an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));
    const w = mountPage();
    await flushPromises();
    sockets[0].frame!({ t: 'sessions', list: [] });
    await flushPromises();
    expect(w.findAll('[data-test="session"]').length).toBe(0);
    expect(w.text()).toContain('没有正在运行的会话');
  });
  it('shows an error when the API fails and closes the socket on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain('加载会话列表失败');
    w.unmount();
    expect(sockets[0].closed).toBe(true);
  });
});
