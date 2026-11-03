import { describe, expect, it } from 'vitest';
import vacancyFull from '../../fixtures/vacancy.full.json';
import { documentToMarkdown, toEditable } from '../../src/shared/markdown';
import { VacancyDocumentSchema } from '../../src/shared/schemas';
import { ClientAbortedError, callWithBudget, createBudget } from '../../src/server/budget';
import { AppError, ProviderHttpError } from '../../src/server/errors';
import { failureToError } from '../../src/client/state/messages';
import { createRateLimiter } from '../../src/server/rateLimit';
import { toProviderSchema } from '../../src/server/prompts';

describe('Markdown-экспорт', () => {
  const doc = toEditable(VacancyDocumentSchema.parse(vacancyFull));

  it('пять разделов в порядке, пустой раздел — «Не указано», блок «Нужно уточнить»', () => {
    const md = documentToMarkdown(doc);
    const headings = md.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## Ежедневные задачи', '## Текущий проект', '## Следующие полгода', '## Инструменты', '## Знания', '## Нужно уточнить']);
    const empty = { ...doc, sections: doc.sections.map((s) => (s.id === 'knowledge' ? { ...s, items: [] } : s)) };
    expect(documentToMarkdown(empty)).toContain('## Знания\n\nНе указано');
  });

  it('HTML экранируется, переводы строк внутри пункта схлопываются', () => {
    const md = documentToMarkdown({ ...doc, title: '<script>x</script>', sections: doc.sections.map((s, i) => (i === 0 ? { ...s, items: [{ key: 'k', text: 'строка\nвторая', sourceFactIds: [] }] } : s)) });
    expect(md).toContain('# \\<script>x\\</script>');
    expect(md).toContain('- строка вторая');
  });
});

describe('бюджет вызова провайдера', () => {
  const noSleep = async () => undefined;

  it('один повтор для 5xx, затем ошибка', async () => {
    let n = 0;
    const budget = createBudget(5000, new AbortController().signal);
    await expect(
      callWithBudget(budget, async () => {
        n += 1;
        throw new ProviderHttpError('x', 500);
      }, { sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(n).toBe(2);
  });

  it('4xx (кроме 429) не повторяется', async () => {
    let n = 0;
    const budget = createBudget(5000, new AbortController().signal);
    await expect(callWithBudget(budget, async () => {
      n += 1;
      throw new ProviderHttpError('x', 400);
    }, { sleep: noSleep })).rejects.toBeInstanceOf(AppError);
    expect(n).toBe(1);
  });

  it('повтор не выходит за бюджет: Retry-After больше остатка → сразу ошибка', async () => {
    let n = 0;
    const budget = createBudget(1000, new AbortController().signal);
    await expect(callWithBudget(budget, async () => {
      n += 1;
      throw new ProviderHttpError('x', 429, 30);
    }, { maxRetryDelayMs: 5000, sleep: noSleep })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(n).toBe(1);
  });

  it('отмена клиентом → ClientAbortedError', async () => {
    const ctrl = new AbortController();
    const budget = createBudget(5000, ctrl.signal);
    const p = callWithBudget(budget, (signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('a')))));
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(ClientAbortedError);
  });
});

describe('ограничение частоты', () => {
  it('N запросов в минуту, затем 429 с задержкой', () => {
    const rl = createRateLimiter(2);
    expect(rl.check('ip', 0).allowed).toBe(true);
    expect(rl.check('ip', 10).allowed).toBe(true);
    const third = rl.check('ip', 20);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(60);
    expect(rl.check('ip', 60_001).allowed).toBe(true);
  });
});

describe('тексты ошибок (docs/11)', () => {
  const ctx = { questionId: 'q1' as const, requestId: 'req-00000001', retry: { op: 'analyze' as const, questionId: 'q1' as const }, mode: 'live' as const };
  it('каждая ошибка: что не удалось, что сохранилось, действия', () => {
    const cases = [
      [{ kind: 'network', uploadComplete: false }, 'transcribe', 'N03'],
      [{ kind: 'network', uploadComplete: true }, 'analyze', 'N04'],
      [{ kind: 'network', uploadComplete: true }, 'generate', 'N05'],
      [{ kind: 'timeout' }, 'analyze', 'S19'],
      [{ kind: 'invalid_response', status: 200 }, 'analyze', 'S20'],
      [{ kind: 'http', status: 429, error: { code: 'RATE_LIMITED', message: '', retryable: true, retryAfterSeconds: 12 } }, 'analyze', 'S17'],
      [{ kind: 'http', status: 502, error: { code: 'PROVIDER_ERROR', message: '', retryable: true } }, 'analyze', 'S18'],
      [{ kind: 'http', status: 503, error: { code: 'CONFIGURATION_ERROR', message: '', retryable: false } }, 'analyze', 'S24'],
      [{ kind: 'http', status: 422, error: { code: 'NO_SPEECH', message: '', retryable: false } }, 'transcribe', 'S04'],
    ] as const;
    for (const [failure, op, id] of cases) {
      const e = failureToError(op, failure as never, ctx)!;
      expect(e.stateId).toBe(id);
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.saved.length).toBeGreaterThan(5);
      expect(e.actions.length).toBeGreaterThan(0);
      expect(e.title).not.toMatch(/\b\d{3}\b/);
    }
    expect(failureToError('analyze', { kind: 'aborted' }, ctx)).toBeNull();
  });

  it('S24 не предлагает переключиться в demo', () => {
    const e = failureToError('analyze', { kind: 'http', status: 503, error: { code: 'CONFIGURATION_ERROR', message: '', retryable: false } }, ctx)!;
    expect(e.message).toContain('не включается автоматически');
  });
});

describe('схема для провайдера', () => {
  it('удаляет только неподдерживаемые ограничения', () => {
    expect(toProviderSchema({ type: 'array', minItems: 8, maxItems: 8, items: { type: 'string', minLength: 1 } })).toEqual({ type: 'array', items: { type: 'string' } });
    expect(toProviderSchema({ type: 'array', minItems: 1 })).toEqual({ type: 'array', minItems: 1 });
  });
});
