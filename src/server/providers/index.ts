import type { ServerConfig } from '../config';
import { AppError } from '../errors';
import { loadPrompts } from '../prompts';
import { AnthropicAnalyzer, AnthropicClient, AnthropicGenerator } from './anthropic';
import { OllamaClient } from './ollama';
import { WhisperTranscriber, whisperConfigured } from './whisper';
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
    sttConfigured: config.sttProvider === 'whisper' ? whisperConfigured(config.whisper) : Boolean(config.deepgramApiKey),
    llmConfigured: Boolean(config.llmModel && (config.llmProvider === 'ollama' || config.anthropicApiKey)),
  };
}

export function createProviders(config: ServerConfig, fetchImpl?: typeof fetch): Providers {
  if (config.mode === 'demo') {
    return { transcriber: new FixtureTranscriber(), analyzer: new FixtureAnalyzer(), generator: new TemplateGenerator() };
  }
  const transcriber: Transcriber = config.sttProvider === 'whisper'
    ? new WhisperTranscriber(config.whisper)
    : config.deepgramApiKey
    ? new DeepgramTranscriber({ apiKey: config.deepgramApiKey, model: config.sttModel, language: config.sttLanguage, fetchImpl })
    : new UnconfiguredProvider(config.sttModel, 'DEEPGRAM_API_KEY');
  if (!config.llmModel || (config.llmProvider === 'anthropic' && !config.anthropicApiKey)) {
    const missing = [config.llmProvider === 'anthropic' && !config.anthropicApiKey && 'ANTHROPIC_API_KEY', !config.llmModel && 'LLM_MODEL'].filter(Boolean).join(', ');
    const stub = new UnconfiguredProvider(config.llmModel, missing);
    return { transcriber, analyzer: stub, generator: stub };
  }
  const prompts = loadPrompts(config.rootDir);
  const llmModel = config.llmModel;
  const client = config.llmProvider === 'ollama'
    ? new OllamaClient(llmModel, config.ollamaUrl)
    : new AnthropicClient({
    apiKey: config.anthropicApiKey!,
    model: llmModel,
    maxTokens: config.llmMaxTokens,
    prompts,
    fetchImpl,
  });
  return {
    transcriber,
    analyzer: new AnthropicAnalyzer(client, prompts),
    generator: config.llmProvider === 'ollama'
      ? {
          source: 'local_template' as const,
          model: null,
          promptVersion: 'local-template-1.0',
          generate: (input) => new TemplateGenerator().generate(input),
        }
      : new AnthropicGenerator(client, prompts),
  };
}
