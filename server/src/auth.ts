import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';

export const COOKIE_NAME = 'ccm';
const HOOK_PATH = '/api/hook';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function tokenFromRequest(req: { headers: IncomingHttpHeaders; url?: string }): string | undefined {
  const url = new URL(req.url ?? '/', 'http://local');
  const q = url.searchParams.get('t');
  if (q) return q;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME];
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function isAuthorized(req: { headers: IncomingHttpHeaders; url?: string }, token: string): boolean {
  const given = tokenFromRequest(req);
  return typeof given === 'string' && equal(given, token);
}

export function authMiddleware(token: string): RequestHandler {
  return (req, res, next) => {
    if (req.path === HOOK_PATH) return next();
    if (!isAuthorized(req, token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.searchParams.get('t')) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    next();
  };
}
