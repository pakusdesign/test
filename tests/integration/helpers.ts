import { LIMITS } from '../../src/shared/constants';
import type { ServerConfig } from '../../src/server/config';
import { createApp } from '../../src/server/app';
import { createLogger, type LogEvent } from '../../src/server/logger';
import { createProviders } from '../../src/server/providers';
import type { Analyzer, Generator, ModelOutput, Providers, Transcriber } from '../../src/server/providers/types';
import casesJson from '../../fixtures/cases.json';

export const QIDS = ['q1', 'q2', 'q3', 'q4'] as const;

export function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    mode: 'demo',
    port: 0,
    host: '127.0.0.1',
    deepgramApiKey: null,
    anthropicApiKey: null,
    sttProvider: 'deepgram',
    whisper: { binary: '', ffmpeg: '', modelPath: '', language: 'ru' },
    sttModel: 'nova-3',
    sttLanguage: 'ru',
    llmModel: null,
    llmMaxTokens: 4096,
    rateLimitPerMinute: 1000,
    providerTimeoutMs: LIMITS.providerTimeoutMs,
    clientDir: null,
    rootDir: process.cwd(),
    ...overrides,
  };
}

export function logCapture() {
  const events: (LogEvent & { ts: string })[] = [];
  return { events, logger: createLogger((e) => events.push(e)) };
}

export function demoApp(overrides: Partial<ServerConfig> = {}) {
  const cfg = config(overrides);
  const logs = logCapture();
  return { app: createApp({ config: cfg, providers: createProviders(cfg), logger: logs.logger }), logs };
}

export function appWith(providers: Partial<Providers>, overrides: Partial<ServerConfig> = {}) {
  const cfg = config({ mode: 'live', ...overrides });
  const base = createProviders(config({ mode: 'demo' }));
  const logs = logCapture();
  return {
    app: createApp({ config: cfg, providers: { ...base, ...providers } as Providers, logger: logs.logger }),
    logs,
  };
}

export function answersFor(caseId: string) {
  const c = casesJson.cases.find((x) => x.id === caseId)!;
  return c.answers
    .map((text, i) => ({ id: `a${i + 1}`, questionId: QIDS[i]!, revision: 1, text, active: true }))
    .filter((a) => a.text !== '');
}

let counter = 0;
export function rid(): string {
  counter += 1;
  return `test-req-${counter.toString().padStart(6, '0')}`;
}

export function snapshot(answers: ReturnType<typeof answersFor>, confirmedFactIds: string[] = [], sessionRevision = 1) {
  return { sessionRevision, answers, confirmedFactIds };
}

/** Анализатор с очередью ответов: для проверки repair, повторов и тайм-аутов. */
export function scriptedAnalyzer(steps: ((signal: AbortSignal, input: Parameters<Analyzer['analyze']>[0]) => Promise<ModelOutput>)[]) {
  const calls: Parameters<Analyzer['analyze']>[0][] = [];
  const analyzer: Analyzer = {
    source: 'provider',
    model: 'fake-model',
    promptVersion: 'test',
    async analyze(input) {
      calls.push(input);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
      return step(input.signal, input);
    },
  };
  return { analyzer, calls };
}

export function scriptedGenerator(steps: ((input: Parameters<Generator['generate']>[0]) => Promise<ModelOutput>)[]) {
  const calls: Parameters<Generator['generate']>[0][] = [];
  const generator: Generator = {
    source: 'provider',
    model: 'fake-model',
    promptVersion: 'test',
    async generate(input) {
      calls.push(input);
      return steps[Math.min(calls.length - 1, steps.length - 1)]!(input);
    },
  };
  return { generator, calls };
}

export function spyTranscriber(text = 'Проверяет счета поставщиков.') {
  const calls: Parameters<Transcriber['transcribe']>[0][] = [];
  const transcriber: Transcriber = {
    source: 'provider',
    model: 'fake-stt',
    async transcribe(input) {
      calls.push(input);
      return { text, language: 'ru' };
    },
  };
  return { transcriber, calls };
}

export const output = (raw: unknown): ModelOutput => ({ raw, rawText: JSON.stringify(raw) });

export function hangUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}
