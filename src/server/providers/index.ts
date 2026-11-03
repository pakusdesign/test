import type { ServerConfig } from '../config';
import { AppError } from '../errors';
import { loadPrompts } from '../prompts';
import { AnthropicAnalyzer, AnthropicClient, AnthropicGenerator } from './anthropic';
import { DeepgramTranscriber } from './deepgram';
import { FixtureAnalyzer, FixtureTranscriber, TemplateGenerator } from './fixture';
import type { Analyzer, Generator, Providers, Transcriber } from './types';

/** Провайдер live без ключа: каждый вызов — CONFIGURATION_ERROR, без перехода в demo. */
class UnconfiguredProvider implements Transcriber, Analyzer, Generator {
  readonly source = 'provider' as const;
  readonly promptVersion = 'n/a';
  constructor(
    readonly model: string | null,
    private readonly missing: string,
  ) {}
  private fail(): never {
    throw new AppError('CONFIGURATION_ERROR', { detail: `не задано: ${this.missing}` });
  }
  async transcribe(): Promise<never> {
    this.fail();
  }
  async analyze(): Promise<never> {
    this.fail();
  }
  async generate(): Promise<never> {
    this.fail();
  }
}

export function liveReadiness(config: ServerConfig): { sttConfigured: boolean; llmConfigured: boolean } {
  return {
    sttConfigured: Boolean(config.deepgramApiKey),
    llmConfigured: Boolean(config.anthropicApiKey && config.llmModel),
  };
}

export function createProviders(config: ServerConfig, fetchImpl?: typeof fetch): Providers {
  if (config.mode === 'demo') {
    return { transcriber: new FixtureTranscriber(), analyzer: new FixtureAnalyzer(), generator: new TemplateGenerator() };
  }
  const transcriber: Transcriber = config.deepgramApiKey
    ? new DeepgramTranscriber({ apiKey: config.deepgramApiKey, model: config.sttModel, language: config.sttLanguage, fetchImpl })
    : new UnconfiguredProvider(config.sttModel, 'DEEPGRAM_API_KEY');
  if (!config.anthropicApiKey || !config.llmModel) {
    const missing = [!config.anthropicApiKey && 'ANTHROPIC_API_KEY', !config.llmModel && 'LLM_MODEL'].filter(Boolean).join(', ');
    const stub = new UnconfiguredProvider(config.llmModel, missing);
    return { transcriber, analyzer: stub, generator: stub };
  }
  const prompts = loadPrompts(config.rootDir);
  const client = new AnthropicClient({
    apiKey: config.anthropicApiKey,
    model: config.llmModel,
    maxTokens: config.llmMaxTokens,
    prompts,
    fetchImpl,
  });
  return {
    transcriber,
    analyzer: new AnthropicAnalyzer(client, prompts),
    generator: new AnthropicGenerator(client, prompts),
  };
}
