import { createApp } from './app';
import { loadDotEnv, loadServerConfig } from './config';
import { createLogger } from './logger';
import { createProviders, liveReadiness } from './providers';

const rootDir = process.cwd();
loadDotEnv(rootDir);
const config = loadServerConfig(process.env, rootDir);
const logger = createLogger();
const app = createApp({ config, providers: createProviders(config), logger });

const server = app.listen(config.port, config.host, () => {
  const readiness = config.mode === 'live' ? liveReadiness(config) : undefined;
  // Ключи не выводятся: только факт их наличия.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      stage: 'listening',
      url: `http://${config.host}:${config.port}`,
      mode: config.mode,
      servesClient: Boolean(config.clientDir),
      ...(readiness ? { sttConfigured: readiness.sttConfigured, llmConfigured: readiness.llmConfigured, llmModel: config.llmModel } : {}),
    }),
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
