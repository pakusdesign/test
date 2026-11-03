/**
 * Live STT: Deepgram pre-recorded API (POST /v1/listen), модель и язык из конфигурации.
 * Аудио передаётся телом запроса с фактическим MIME-типом записи; на диск не пишется.
 * Проверено только на подменённом HTTP; реальный вызов требует ключа.
 */
import { AppError, ProviderHttpError, ProviderOutputError, parseRetryAfter } from '../errors';
import type { Transcriber, TranscribeInput, TranscribeResult } from './types';

export const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

export interface DeepgramOptions {
  apiKey: string;
  model: string;
  language: string;
  fetchImpl?: typeof fetch;
}

interface DeepgramResponse {
  results?: {
    channels?: { alternatives?: { transcript?: string }[]; detected_language?: string }[];
  };
}

export class DeepgramTranscriber implements Transcriber {
  readonly source = 'provider' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepgramOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get model(): string {
    return this.options.model;
  }

  buildUrl(): string {
    const url = new URL(DEEPGRAM_URL);
    url.searchParams.set('model', this.options.model);
    url.searchParams.set('language', this.options.language);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');
    return url.toString();
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!input.audio || input.audio.length === 0 || !input.mimeType) {
      throw new AppError('NO_SPEECH', { message: 'Запись пуста' });
    }
    const response = await this.fetchImpl(this.buildUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.options.apiKey}`,
        'Content-Type': input.mimeType,
      },
      body: new Uint8Array(input.audio),
      signal: input.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 400 || response.status === 415) {
        // Deepgram не смог разобрать контейнер — сообщаем как неподдерживаемый формат.
        throw new AppError('UNSUPPORTED_AUDIO', { detail: `deepgram HTTP ${response.status}` });
      }
      throw new ProviderHttpError('deepgram', response.status, parseRetryAfter(response.headers.get('retry-after')));
    }
    const body = (await response.json()) as DeepgramResponse;
    const channel = body.results?.channels?.[0];
    const transcript = channel?.alternatives?.[0]?.transcript;
    if (typeof transcript !== 'string') throw new ProviderOutputError('deepgram', 'нет transcript');
    if (transcript.trim() === '') throw new AppError('NO_SPEECH');
    return { text: transcript.trim(), language: channel?.detected_language ?? this.options.language };
  }
}
