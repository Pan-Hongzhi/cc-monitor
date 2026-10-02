import { Router, json, type RequestHandler } from 'express';
import type { EventEmitter } from 'node:events';

export interface HookEvent {
  sessionId: string;
  event: string;
  data: Record<string, unknown>;
}

export function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function hookHandler(bus: EventEmitter): RequestHandler {
  return (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) {
      res.status(403).end();
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || typeof body.hook_event_name !== 'string' || typeof body.session_id !== 'string') {
      res.status(400).end();
      return;
    }
    const ev: HookEvent = { sessionId: body.session_id, event: body.hook_event_name, data: body };
    bus.emit('hook', ev);
    res.status(200).end();
  };
}

export function hooksRouter(bus: EventEmitter): Router {
  const r = Router();
  r.post('/api/hook', json({ limit: '1mb' }), hookHandler(bus));
  return r;
}

export function hooksSettingsSnippet(port: number): string {
  const handler = [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hook`, timeout: 5 }] }];
  return JSON.stringify({ hooks: { PermissionRequest: handler, Notification: handler, Stop: handler } }, null, 2);
}
