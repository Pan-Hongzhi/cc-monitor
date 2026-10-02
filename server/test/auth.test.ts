import { describe, it, expect } from 'vitest';
import { parseCookies, tokenFromRequest, isAuthorized, authMiddleware, COOKIE_NAME } from '../src/auth.js';

const TOKEN = 'f'.repeat(32);

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return { res, headers };
}

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
  it('middleware sets the cookie on a valid query token and passes', () => {
    const mw = authMiddleware(TOKEN);
    const { res, headers } = fakeRes();
    let passed = false;
    mw({ headers: {}, url: `/?t=${TOKEN}`, path: '/' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(true);
    expect(headers['Set-Cookie']).toContain(`${COOKIE_NAME}=${TOKEN}`);
    expect(headers['Set-Cookie']).toContain('HttpOnly');
    expect(headers['Set-Cookie']).toContain('SameSite=Lax');
  });
  it('middleware rejects missing or wrong tokens with 401', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ headers: {}, url: '/api/sessions', path: '/api/sessions' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });
  it('middleware lets /api/hook through untouched', () => {
    const mw = authMiddleware(TOKEN);
    const { res } = fakeRes();
    let passed = false;
    mw({ headers: {}, url: '/api/hook', path: '/api/hook' } as never, res as never, () => { passed = true; });
    expect(passed).toBe(true);
  });
});
