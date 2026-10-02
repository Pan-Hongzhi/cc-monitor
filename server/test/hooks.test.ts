import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { isLoopback, hookHandler, hooksSettingsSnippet, type HookEvent } from '../src/hooks.js';

function fakeRes() {
  const res = {
    statusCode: 200,
    ended: false,
    status(code: number) { this.statusCode = code; return this; },
    end() { this.ended = true; return this; },
    json() { this.ended = true; return this; },
  };
  return res;
}

describe('hooks', () => {
  it('recognizes loopback addresses only', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.8')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
  it('rejects non-loopback callers with 403 and emits nothing', () => {
    const bus = new EventEmitter();
    const got: HookEvent[] = [];
    bus.on('hook', (e) => got.push(e));
    const res = fakeRes();
    hookHandler(bus)({ socket: { remoteAddress: '192.168.1.8' }, body: { hook_event_name: 'Stop', session_id: 's' } } as never, res as never, () => {});
    expect(res.statusCode).toBe(403);
    expect(got).toEqual([]);
  });
  it('rejects bodies without event name or session id with 400', () => {
    const bus = new EventEmitter();
    const res = fakeRes();
    hookHandler(bus)({ socket: { remoteAddress: '127.0.0.1' }, body: { foo: 1 } } as never, res as never, () => {});
    expect(res.statusCode).toBe(400);
  });
  it('emits the event and answers 200 with an empty body', () => {
    const bus = new EventEmitter();
    const got: HookEvent[] = [];
    bus.on('hook', (e) => got.push(e));
    const res = fakeRes();
    const body = { hook_event_name: 'Notification', session_id: 'abc', notification_type: 'permission_prompt', message: 'x' };
    hookHandler(bus)({ socket: { remoteAddress: '::1' }, body } as never, res as never, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(got).toEqual([{ sessionId: 'abc', event: 'Notification', data: body }]);
  });
  it('produces a settings snippet with the three events pointing at loopback', () => {
    const snippet = JSON.parse(hooksSettingsSnippet(8787));
    for (const ev of ['PermissionRequest', 'Notification', 'Stop']) {
      expect(snippet.hooks[ev][0].hooks[0]).toEqual({ type: 'http', url: 'http://127.0.0.1:8787/api/hook', timeout: 5 });
    }
  });
});
