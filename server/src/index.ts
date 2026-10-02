import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import qrcode from 'qrcode-terminal';
import { loadOrCreateConfig, defaultConfigPath } from './config.js';
import { authMiddleware } from './auth.js';
import { RegistryWatcher, TasklistProbe, claudeConfigDir } from './registry.js';
import { AttachManager, nodePtyFactory } from './attach.js';
import { TranscriptHub, attachWebSocketServer, lanAddresses } from './ws.js';
import { hooksRouter, hooksSettingsSnippet } from './hooks.js';

const configPath = defaultConfigPath();
const cfg = loadOrCreateConfig(configPath);
const configDir = claudeConfigDir();

const registry = new RegistryWatcher(join(configDir, 'sessions'), new TasklistProbe());
const attach = new AttachManager(nodePtyFactory(cfg.claudeExe), {
  minCols: cfg.minCols,
  minRows: cfg.minRows,
  bufferChars: cfg.ringBufferKB * 1024,
  idleDetachMs: cfg.idleDetachMinutes * 60_000,
});
const transcripts = new TranscriptHub(configDir);
const hookBus = new EventEmitter();

const app = express();
app.use(hooksRouter(hookBus));
app.use(authMiddleware(cfg.token));

app.get('/api/sessions', async (_req, res) => {
  res.json(await registry.refresh());
});

app.get('/api/sessions/:sid/transcript', async (req, res) => {
  const info = registry.current().find((s) => s.sessionId === req.params.sid);
  if (!info) {
    res.status(404).json({ error: '会话不存在' });
    return;
  }
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  res.json(await transcripts.history(info, limit));
});

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('网页尚未构建：先运行 npm run build -w web'));
}

const server = createServer(app);
attachWebSocketServer(server, { token: cfg.token, registry, attach, transcripts, hookBus });
registry.start();

server.listen(cfg.port, cfg.bind, () => {
  const hosts = cfg.bind === '0.0.0.0' ? lanAddresses() : [cfg.bind];
  console.log(`cc-monitor 已启动，配置文件：${configPath}`);
  for (const h of hosts) console.log(`  http://${h}:${cfg.port}/?t=${cfg.token}`);
  if (hosts[0]) qrcode.generate(`http://${hosts[0]}:${cfg.port}/?t=${cfg.token}`, { small: true });
  console.log('如需手机提醒，把下面这段合并进 ~/.claude/settings.json 的 hooks：');
  console.log(hooksSettingsSnippet(cfg.port));
});

function shutdown(): void {
  registry.stop();
  transcripts.stopAll();
  attach.disposeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
