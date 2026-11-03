import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIMITS } from '../shared/constants';

export type AppMode = 'demo' | 'live';

export interface ServerConfig {
  mode: AppMode;
  port: number;
  host: string;
  deepgramApiKey: string | null;
  anthropicApiKey: string | null;
  sttModel: string;
  sttLanguage: string;
  llmModel: string | null;
  llmMaxTokens: number;
  rateLimitPerMinute: number;
  providerTimeoutMs: number;
  /** Каталог собранного клиента; null — клиент не раздаётся (dev). */
  clientDir: string | null;
  rootDir: string;
}

function nonEmpty(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function intOr(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Читает .env из корня проекта, если файл есть (Node 22: process.loadEnvFile). */
export function loadDotEnv(rootDir: string): void {
  const file = path.join(rootDir, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): ServerConfig {
  const rawMode = (env.APP_MODE ?? 'demo').trim().toLowerCase();
  if (rawMode !== 'demo' && rawMode !== 'live') {
    throw new Error(`APP_MODE должен быть demo или live, получено: ${rawMode}`);
  }
  const clientDir = path.join(rootDir, 'dist', 'client');
  return {
    mode: rawMode,
    port: intOr(env.PORT, 3001, 1, 65535),
    host: nonEmpty(env.HOST) ?? '127.0.0.1',
    deepgramApiKey: nonEmpty(env.DEEPGRAM_API_KEY),
    anthropicApiKey: nonEmpty(env.ANTHROPIC_API_KEY),
    sttModel: nonEmpty(env.STT_MODEL) ?? 'nova-3',
    sttLanguage: nonEmpty(env.STT_LANGUAGE) ?? 'ru',
    llmModel: nonEmpty(env.LLM_MODEL),
    llmMaxTokens: intOr(env.LLM_MAX_TOKENS, 4096, 512, 32000),
    rateLimitPerMinute: intOr(env.RATE_LIMIT_PER_MINUTE, 20, 1, 10000),
    providerTimeoutMs: intOr(env.PROVIDER_TIMEOUT_MS, LIMITS.providerTimeoutMs, 1000, 120000),
    clientDir: existsSync(path.join(clientDir, 'index.html')) ? clientDir : null,
    rootDir,
  };
}
