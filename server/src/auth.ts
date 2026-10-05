import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';

export const COOKIE_NAME = 'ccm';
const HOOK_PATH = '/api/hook';

export const UNAUTHORIZED_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>需要访问口令</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #111; color: #eee; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 420px; padding: 24px; line-height: 1.7; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  code { background: #222; padding: 2px 6px; border-radius: 4px; }
  p { margin: 8px 0; color: #ccc; }
</style>
</head>
<body>
<main>
  <h1>需要访问口令</h1>
  <p>这个浏览器还没有记住 cc-monitor 的口令。</p>
  <p>请用手机扫描启动监测器时终端里打印的二维码，或者打开终端里那条带 <code>?t=</code> 的完整链接。</p>
  <p>每个浏览器只需要这样做一次，之后直接打开地址即可。</p>
</main>
</body>
</html>
`;

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

// 浏览器的页面导航带 Accept: text/html；接口调用和 CLI 不带，仍按 JSON 处理
function isPageNavigation(req: { method?: string; path?: string; headers: IncomingHttpHeaders }): boolean {
  if (req.method !== 'GET') return false;
  if ((req.path ?? '').startsWith('/api/')) return false;
  return String(req.headers.accept ?? '').includes('text/html');
}

export function authMiddleware(token: string): RequestHandler {
  return (req, res, next) => {
    if (req.path === HOOK_PATH) return next();
    if (!isAuthorized(req, token)) {
      if (isPageNavigation(req)) {
        res.status(401).type('html').send(UNAUTHORIZED_PAGE);
        return;
      }
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.searchParams.get('t')) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
      if (isPageNavigation(req)) {
        // 口令已记进 cookie，把它从地址栏去掉，免得留在历史记录和截图里
        url.searchParams.delete('t');
        res.redirect(302, url.pathname + url.search);
        return;
      }
    }
    next();
  };
}
