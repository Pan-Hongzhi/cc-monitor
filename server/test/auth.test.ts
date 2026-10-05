import { describe, it, expect } from 'vitest';
import { parseCookies, tokenFromRequest, isAuthorized, authMiddleware, COOKIE_NAME } from '../src/auth.js';

const TOKEN = 'f'.repeat(32);

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    contentType: '',
    redirectedTo: '',
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status(code: number) { this.statusCode = code; return this; },
    type(t: string) { this.contentType = t; return this; },
    send(b: unknown) { this.body = b; return this; },
    json(b: unknown) { this.body = b; return this; },
    redirect(code: number, to: string) { this.statusCode = code; this.redirectedTo = to; return this; },
  };
  return { res, headers };
}

const html = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

describe('auth', () => {
  it('parses cookies', () => {
    expect(parseCookies('a=1; ccm=abc; x=y=z')).toEqual({ a: '1', ccm: 'abc', x: 'y=z' });
    expect(parseCookies(undefined)).toEqual({});
  });
  it('reads the token from query or cookie', () => {
    expect(tokenFromRequest({ headers: {}, url: '/?t=abc' })).toBe('abc');
    expect(tokenFromRequest({ headers: { cookie: `${COOKIE_NAME}=def` }, url: '/' })).toBe('def');
    expect(tokenFromRequest({ headers: {}, url: '/' })).toBeUndefined();
  });
  it('authorizes only an exact token', () => {
    expect(isAuthorized({ headers: {}, url: `/?t=${TOKEN}` }, TOKEN)).toBe(true);
    expect(isAuthorized({ headers: { cookie: `${COOKIE_NAME}=${TOKEN}` }, url: '/' }, TOKEN)).toBe(true);
    expect(isAuthorized({ headers: {}, url: `/?t=${TOKEN.slice(1)}` }, TOKEN)).toBe(false);
    expect(isAuthorized({ headers: {}, url: '/' }, TOKEN)).toBe(false);
  });
  it('middleware sets the cookie on a valid query token and passes non-page requests through', () => {
    const mw = authMiddleware(TOKEN);
    const { res, headers } = fakeRes();
    let passed = false;
    mw({ method: 'GET', headers: {}, url: `/api/sessions?t=${TOKEN}`, path: '/api/sessions' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(true);
    expect(headers['Set-Cookie']).toContain(`${COOKIE_NAME}=${TOKEN}`);
    expect(headers['Set-Cookie']).toContain('HttpOnly');
    expect(headers['Set-Cookie']).toContain('SameSite=Lax');
  });
  it('middleware redirects a page navigation to the same address without the token once the cookie is set', () => {
    const mw = authMiddleware(TOKEN);
    const { res, headers } = fakeRes();
    let passed = false;
    mw({ method: 'GET', headers: html, url: `/s/abc?t=${TOKEN}&x=1`, path: '/s/abc' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(false);
    expect(headers['Set-Cookie']).toContain(`${COOKIE_NAME}=${TOKEN}`);
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('/s/abc?x=1');
  });
  it('middleware rejects missing or wrong tokens on API calls with 401 JSON', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ method: 'GET', headers: {}, url: '/api/sessions', path: '/api/sessions' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });
  it('middleware answers an unauthorized page navigation with an explanation page instead of JSON', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ method: 'GET', headers: html, url: '/', path: '/' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.contentType).toBe('html');
    expect(String(res.body)).toContain('二维码');
    expect(String(res.body)).toContain('?t=');
  });
  it('middleware lets /api/hook through untouched', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ method: 'POST', headers: {}, url: '/api/hook', path: '/api/hook' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(true);
  });
});
