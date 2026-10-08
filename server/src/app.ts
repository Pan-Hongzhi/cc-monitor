import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEmitter } from 'node:events';
import express from 'express';
import { authMiddleware } from './auth.js';
import { hooksRouter } from './hooks.js';
import type { RegistryWatcher } from './registry.js';
import type { AttachManager } from './attach.js';
import type { TranscriptHub } from './ws.js';
import { stopSession, defaultRunner, type ClaudeRunner } from './control.js';

export interface AppDeps {
  token: string;
  registry: RegistryWatcher;
  attach: AttachManager;
  transcripts: TranscriptHub;
  hookBus: EventEmitter;
  stopRunner?: ClaudeRunner;
  webDist?: string;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(hooksRouter(deps.hookBus));
  app.use(authMiddleware(deps.token));

  app.get('/api/sessions', async (_req, res) => {
    res.json(await deps.registry.refresh());
  });

  app.get('/api/sessions/:sid/transcript', async (req, res) => {
    const info = deps.registry.current().find((s) => s.sessionId === req.params.sid);
    if (!info) {
      res.status(404).json({ error: '会话不存在' });
      return;
    }
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
    res.json(await deps.transcripts.history(info, limit));
  });

  // 停止后台会话：相当于在电脑上运行 claude stop <短id>，对话记录保留
  app.post('/api/sessions/:sid/stop', async (req, res) => {
    const info = deps.registry.current().find((s) => s.sessionId === req.params.sid);
    if (!info) {
      res.status(404).json({ ok: false, output: '会话不存在' });
      return;
    }
    if (!info.attachable || !info.jobId) {
      res.status(400).json({ ok: false, output: '这个会话不是用 claude --bg 启动的，只能在它自己的终端里关闭' });
      return;
    }
    const session = deps.attach.peek(info.jobId);
    session?.expectExit('会话已停止');
    const r = await stopSession(info.jobId, deps.stopRunner ?? defaultRunner);
    if (!r.ok) session?.expectExit(null);
    void deps.registry.refresh();
    res.status(r.ok ? 200 : 502).json(r);
  });

  if (deps.webDist && existsSync(deps.webDist)) {
    const dist = deps.webDist;
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('网页尚未构建：先运行 npm run build -w web'));
  }

  return app;
}
