import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { loadOrCreateConfig, defaultConfigPath } from './config.js';
import { RegistryWatcher, TasklistProbe, claudeConfigDir } from './registry.js';
import { AttachManager, nodePtyFactory } from './attach.js';
import { TranscriptHub, attachWebSocketServer, lanAddresses } from './ws.js';
import { hooksSettingsSnippet } from './hooks.js';
import { createApp } from './app.js';

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

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = createApp({ token: cfg.token, registry, attach, transcripts, hookBus, webDist });

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
