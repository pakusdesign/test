/**
 * Маршруты, лимиты, ошибки провайдеров, repair, тайм-ауты, live без ключей.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import analysisFull from '../../fixtures/analysis.full.json';
import { ProviderHttpError } from '../../src/server/errors';
import {
  answersFor,
  appWith,
  config,
  demoApp,
  hangUntilAbort,
  output,
  rid,
  scriptedAnalyzer,
  scriptedGenerator,
  snapshot,
  spyTranscriber,
} from './helpers';
import { createApp } from '../../src/server/app';
import { createProviders } from '../../src/server/providers';

const fullAnswers = answersFor('full');

describe('GET /api/config', () => {
  it('demo: режим, лимиты, сценарии', async () => {
    const { app } = demoApp();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('demo');
    expect(res.body.schemaVersion).toBe('1.0');
    expect(res.body.demo.scenarios.length).toBe(11);
    expect(res.body.limits.maxRecordingSeconds).toBe(120);
  });

  it('live: секреты не попадают в ответ', async () => {
    const cfg = config({ mode: 'live', deepgramApiKey: 'dg-secret-123', anthropicApiKey: 'sk-secret-456', llmModel: 'some-model' });
    const app = createApp({ config: cfg, providers: createProviders(cfg) });
    const res = await request(app).get('/api/config');
    expect(res.body.mode).toBe('live');
    expect(res.body.live).toMatchObject({ sttConfigured: true, llmConfigured: true });
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
  });
});

describe('live без ключей: CONFIGURATION_ERROR, без перехода в demo', () => {
  const cfg = config({ mode: 'live' });
  const app = createApp({ config: cfg, providers: createProviders(cfg) });

  it('анализ → 503', async () => {
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CONFIGURATION_ERROR');
  });

  it('распознавание → 503', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a1')
      .attach('audio', Buffer.from('RIFFxxxx'), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CONFIGURATION_ERROR');
  });
});

describe('лимиты и проверка входа (T22)', () => {
  it('тело больше 256 КиБ → 413 до вызова провайдера', async () => {
    const { analyzer, calls } = scriptedAnalyzer([async () => output(analysisFull)]);
    const { app } = appWith({ analyzer });
    const big = 'а'.repeat(300 * 1024);
    const res = await request(app)
      .post('/api/analyze')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ requestId: rid(), snapshot: snapshot([{ id: 'a1', questionId: 'q1', revision: 1, text: big, active: true }]) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(calls).toHaveLength(0);
  });

  it('ответ длиннее 4000 символов → 400, провайдер не вызывается', async () => {
    const { analyzer, calls } = scriptedAnalyzer([async () => output(analysisFull)]);
    const { app } = appWith({ analyzer });
    const res = await request(app)
      .post('/api/analyze')
      .send({ requestId: rid(), snapshot: snapshot([{ id: 'a1', questionId: 'q1', revision: 1, text: 'х'.repeat(4001), active: true }]) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(calls).toHaveLength(0);
  });

  it('больше 12 активных ответов → 400', async () => {
    const { app } = demoApp();
    const answers = Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, questionId: 'q1', revision: 1, text: 'Проверяет счета поставщиков.', active: true }));
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(answers as never) });
    expect(res.status).toBe(400);
  });

  it('некорректный JSON → 400', async () => {
    const { app } = demoApp();
    const res = await request(app).post('/api/analyze').set('content-type', 'application/json').send('{"requestId":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('неизвестный маршрут → 404 JSON', async () => {
    const { app } = demoApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('HTML в ответе — данные: сервер возвращает его как текст JSON, не исполняет', async () => {
    const html = '<img src=x onerror=alert(1)> Проверяет счета поставщиков.';
    const { analyzer } = scriptedAnalyzer([
      async (_s, input) =>
        output({
          facts: [{ id: 'm1', questionId: 'q1', kind: 'task', text: 'Проверять счета поставщиков.', evidence: [{ answerId: input.answers[0]!.id, answerRevision: 1, quote: 'Проверяет счета поставщиков' }], dependsOn: [] }],
          units: analysisFull.units.map((u) => (u.id === 'q1.task1' ? { ...u, factIds: ['m1'] } : { ...u, state: 'missing', factIds: [] })),
          conflicts: [],
        }),
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot([{ id: 'h1', questionId: 'q1', revision: 1, text: html, active: true }]) });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('ответы модели анализа (T16)', () => {
  const validFor = (input: { answers: { id: string; revision: number }[] }) => {
    const ids = new Map(input.answers.map((a, i) => [`a${i + 1}`, a.id]));
    const clone = structuredClone(analysisFull);
    for (const f of clone.facts) for (const e of f.evidence) e.answerId = ids.get(e.answerId) ?? e.answerId;
    return clone;
  };

  it('неверный JSON дважды → 422 INVALID_MODEL_OUTPUT, ровно один repair', async () => {
    const { analyzer, calls } = scriptedAnalyzer([async () => ({ raw: undefined, rawText: '{oops' })]);
    const { app, logs } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_MODEL_OUTPUT');
    expect(res.body.error.retryable).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.repair?.issues[0]).toMatch(/JSON/);
    expect(JSON.stringify(logs.events)).not.toContain('отказы оплаты');
  });

  it('чужая цитата → repair; второй ответ валиден → 200', async () => {
    const { analyzer, calls } = scriptedAnalyzer([
      async (_s, input) => {
        const bad = validFor(input);
        bad.facts[0]!.evidence[0]!.quote = 'зарплата 500000';
        return output(bad);
      },
      async (_s, input) => output(validFor(input)),
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.repair!.issues.some((i) => i.includes('quote_not_found'))).toBe(true);
    expect(res.body.analysis.facts.every((f: { id: string }) => f.id.startsWith('f_'))).toBe(true);
    expect(res.body.completeness).toBe(0);
  });

  it('несуществующий factId дважды → 422, ложного прогресса нет', async () => {
    const { analyzer } = scriptedAnalyzer([
      async (_s, input) => {
        const bad = validFor(input);
        bad.units[0]!.factIds = ['ghost'];
        return output(bad);
      },
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers, ['f1']) });
    expect(res.status).toBe(422);
    expect(res.body.completeness).toBeUndefined();
  });

  it('модель не может подтвердить факты сама: подтверждение только из snapshot', async () => {
    const { analyzer } = scriptedAnalyzer([async (_s, input) => output(validFor(input))]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers, ['f1', 'f2']) });
    // f1/f2 — ID модели; сервер переназначает ID, поэтому они не совпадают с серверными.
    expect(res.body.completeness).toBe(0);
  });

  it('текст ответа передаётся модели отдельным сообщением как данные', async () => {
    const { analyzer, calls } = scriptedAnalyzer([async (_s, input) => output(validFor(input))]);
    const { app } = appWith({ analyzer });
    await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(calls[0]!.answers.map((a) => a.text)).toEqual(fullAnswers.map((a) => a.text));
  });
});

describe('сбои провайдера (T15)', () => {
  it('429 один раз → автоматический повтор → 200', async () => {
    const { analyzer, calls } = scriptedAnalyzer([
      async () => {
        throw new ProviderHttpError('fake', 429, 0);
      },
      async (_s, input) => {
        const clone = structuredClone(analysisFull);
        for (const f of clone.facts) for (const e of f.evidence) e.answerId = input.answers.find((a) => a.questionId === f.questionId)?.id ?? e.answerId;
        return output(clone);
      },
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('429 дважды → 429 RATE_LIMITED с Retry-After, без бесконечных повторов', async () => {
    const { analyzer, calls } = scriptedAnalyzer([
      async () => {
        throw new ProviderHttpError('fake', 429, 1);
      },
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.retryAfterSeconds).toBe(1);
    expect(res.headers['retry-after']).toBe('1');
    expect(calls).toHaveLength(2);
  });

  it('5xx дважды → 502 PROVIDER_ERROR', async () => {
    const { analyzer, calls } = scriptedAnalyzer([
      async () => {
        throw new ProviderHttpError('fake', 503, 0);
      },
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('PROVIDER_ERROR');
    expect(calls).toHaveLength(2);
  });

  it('тайм-аут бюджета → 504 PROVIDER_TIMEOUT', async () => {
    const { analyzer } = scriptedAnalyzer([(signal) => hangUntilAbort(signal)]);
    const { app } = appWith({ analyzer }, { providerTimeoutMs: 300 });
    const started = Date.now();
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('PROVIDER_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('401 провайдера → 503 CONFIGURATION_ERROR без деталей провайдера', async () => {
    const { analyzer } = scriptedAnalyzer([
      async () => {
        throw new ProviderHttpError('fake', 401);
      },
    ]);
    const { app } = appWith({ analyzer });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/fake|401/);
  });

  it('ограничение частоты AI-запросов в live', async () => {
    const { analyzer } = scriptedAnalyzer([
      async () => {
        throw new ProviderHttpError('fake', 500);
      },
    ]);
    const { app } = appWith({ analyzer }, { rateLimitPerMinute: 2 });
    for (let i = 0; i < 2; i += 1) await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('ответы модели генерации', () => {
  async function confirmedFull() {
    const { app } = demoApp();
    const a = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(fullAnswers) });
    const ids = a.body.analysis.facts.map((f: { id: string }) => f.id);
    return { analysis: a.body.analysis, ids };
  }

  it('T13: модель добавила зарплату → repair → 422, выдуманный текст не возвращается', async () => {
    const { analysis, ids } = await confirmedFull();
    const { generator, calls } = scriptedGenerator([
      async (input) =>
        output({
          title: { text: 'Описание вакансии', sourceFactIds: [] },
          sections: ['daily_tasks', 'current_project', 'next_six_months', 'tools', 'knowledge'].map((id, i) => ({
            id,
            items: i === 0 ? [{ text: 'Зарплата 500000 рублей', sourceFactIds: [input.facts[0]!.id] }] : [],
          })),
          gaps: [],
        }),
    ]);
    const { app } = appWith({ generator });
    const res = await request(app).post('/api/generate').send({ requestId: rid(), snapshot: snapshot(fullAnswers, ids), analysis, confirmedFactIds: ids });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_MODEL_OUTPUT');
    expect(JSON.stringify(res.body)).not.toContain('500000');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.repair!.issues.join(' ')).toMatch(/зарплата/);
  });

  it('ссылка на неподтверждённый факт → 422', async () => {
    const { analysis, ids } = await confirmedFull();
    const { generator } = scriptedGenerator([
      async () =>
        output({
          title: { text: 'Описание вакансии', sourceFactIds: [] },
          sections: ['daily_tasks', 'current_project', 'next_six_months', 'tools', 'knowledge'].map((id) => ({ id, items: [{ text: 'Пункт', sourceFactIds: ['f_unknown'] }] })),
          gaps: [],
        }),
    ]);
    const { app } = appWith({ generator });
    const res = await request(app).post('/api/generate').send({ requestId: rid(), snapshot: snapshot(fullAnswers, ids), analysis, confirmedFactIds: ids });
    expect(res.status).toBe(422);
  });

  it('разделы в другом порядке упорядочиваются; пробелы — серверные', async () => {
    const { analysis, ids } = await confirmedFull();
    const { generator } = scriptedGenerator([
      async (input) =>
        output({
          title: { text: 'Описание вакансии', sourceFactIds: [] },
          sections: ['knowledge', 'tools', 'next_six_months', 'current_project', 'daily_tasks'].map((id) => ({
            id,
            items: id === 'daily_tasks' ? [{ text: 'Анализировать отказы оплаты.', sourceFactIds: [input.facts[0]!.id] }] : [],
          })),
          gaps: ['Не указан уровень зарплаты'],
        }),
    ]);
    const { app } = appWith({ generator });
    const res = await request(app).post('/api/generate').send({ requestId: rid(), snapshot: snapshot(fullAnswers, ids), analysis, confirmedFactIds: ids });
    expect(res.status).toBe(200);
    expect(res.body.document.sections[0].id).toBe('daily_tasks');
    expect(res.body.document.gaps).toEqual(['Название должности не указано.', 'Условия работы не указаны.']);
  });
});

describe('POST /api/transcribe', () => {
  it('demo: ответ сценария, аудио не принимается', async () => {
    const { app } = demoApp();
    const ok = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a1')
      .field('scenarioId', 'full')
      .field('questionId', 'q1');
    expect(ok.status).toBe(200);
    expect(ok.body.source).toBe('fixture');
    expect(ok.body.text).toContain('анализирует отказы оплаты');
    const withAudio = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a1')
      .field('scenarioId', 'full')
      .field('questionId', 'q1')
      .attach('audio', Buffer.from('xx'), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(withAudio.status).toBe(400);
  });

  it('demo: пустой ответ сценария → 422 NO_SPEECH', async () => {
    const { app } = demoApp();
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a2')
      .field('scenarioId', 'one_task')
      .field('questionId', 'q2');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_SPEECH');
  });

  it('demo: уточнение получает текст каталога для единицы', async () => {
    const { app } = demoApp();
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '1')
      .field('answerId', 'c1')
      .field('scenarioId', 'guided')
      .field('questionId', 'q1')
      .field('unitId', 'q1.task2');
    expect(res.body.text).toBe('Ещё каждый день сверяет акты с поставщиками.');
  });

  it('live: неподдерживаемый формат → 415 до вызова STT', async () => {
    const { transcriber, calls } = spyTranscriber();
    const { app } = appWith({ transcriber });
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a1')
      .attach('audio', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.status).toBe(415);
    expect(calls).toHaveLength(0);
  });

  it('live: больше 10 МиБ → 413 до вызова STT', async () => {
    const { transcriber, calls } = spyTranscriber();
    const { app } = appWith({ transcriber });
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a1')
      .attach('audio', Buffer.alloc(10 * 1024 * 1024 + 10), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(calls).toHaveLength(0);
  });

  it('live: пустой файл → 422 NO_SPEECH', async () => {
    const { transcriber, calls } = spyTranscriber();
    const { app } = appWith({ transcriber });
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '0')
      .field('answerId', 'a1')
      .attach('audio', Buffer.alloc(0), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('live: аудио передаётся с фактическим MIME, ответ — текст и answerId', async () => {
    const { transcriber, calls } = spyTranscriber('Проверяет счета поставщиков.');
    const { app, logs } = appWith({ transcriber });
    const res = await request(app)
      .post('/api/transcribe')
      .field('requestId', rid())
      .field('sessionRevision', '3')
      .field('answerId', 'a7')
      .attach('audio', Buffer.from('OggS-fake'), { filename: 'a.m4a', contentType: 'audio/mp4' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answerId: 'a7', sessionRevision: 3, text: 'Проверяет счета поставщиков.', source: 'provider' });
    expect(calls[0]!.mimeType).toBe('audio/mp4');
    expect(JSON.stringify(logs.events)).not.toContain('Проверяет счета');
  });
});
