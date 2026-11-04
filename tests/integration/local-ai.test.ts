import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaClient } from '../../src/server/providers/ollama';
import { createProviders, liveReadiness } from '../../src/server/providers';
import { config } from './helpers';

const originalFetch = globalThis.fetch;
afterEach(() => vi.stubGlobal('fetch', originalFetch));

describe('local language model', () => {
  it('accepts facts quoted from the answer', async () => {
    const answer = { facts: [{ text: 'проверяет счета', evidence: [{ quote: 'Сотрудник проверяет счета.' }] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }), { status: 200 })));
    const out = await new OllamaClient('test-model').structured('system', [{ role: 'user', content: 'answer' }], {}, new AbortController().signal);
    expect(out.raw).toEqual(answer);
  });

  it('rejects invented facts even when JSON is valid', async () => {
    const answer = { facts: [{ text: 'Назовите задачу сотрудника', evidence: [{ quote: 'Сотрудник проверяет счета.' }] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }), { status: 200 })));
    const out = await new OllamaClient('test-model').structured('system', [{ role: 'user', content: 'answer' }], {}, new AbortController().signal);
    expect(out.raw).toBeUndefined();
  });

  it('uses local model for analysis and a labelled template for generation', () => {
    const cfg = config({ mode: 'live', llmProvider: 'ollama', llmModel: 'test-model' });
    expect(liveReadiness(cfg).llmConfigured).toBe(true);
    const providers = createProviders(cfg);
    expect(providers.analyzer.model).toBe('test-model');
    expect(providers.generator.source).toBe('local_template');
  });
});
