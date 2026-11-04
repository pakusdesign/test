import { ProviderHttpError, ProviderOutputError } from '../errors';
import type { ModelOutput } from './types';
import type { StructuredClient } from './anthropic';

/** Local Ollama JSON-schema endpoint. The server validates every output afterward. */
export class OllamaClient implements StructuredClient {
  constructor(readonly model: string, private readonly url = 'http://127.0.0.1:11434/api/chat') {}

  async structured(system: string, messages: { role: 'user' | 'assistant'; content: string }[], schema: unknown, signal: AbortSignal): Promise<ModelOutput> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0, num_ctx: 8192, num_predict: 4096 },
        messages: [{ role: 'system', content: `${system}\n\nПриоритет для извлечения: поле text каждого факта — точная короткая выдержка из evidence.quote. Не копируй вопросы и подсказки из рубрики в факты. Если сведений нет в ответе, ставь missing и не создавай факт.` }, ...messages],
      }),
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderHttpError('ollama', response.status);
    }
    const body = await response.json() as { message?: { content?: string }; done_reason?: string };
    if (body.done_reason === 'length') throw new ProviderOutputError('ollama', 'max_tokens');
    const rawText = body.message?.content;
    if (!rawText) throw new ProviderOutputError('ollama', 'нет текстового блока');
    try {
      const raw: unknown = JSON.parse(rawText);
      return { raw, rawText };
    }
    catch { return { raw: undefined, rawText }; }
  }
}
