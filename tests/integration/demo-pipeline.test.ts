/**
 * Demo-конвейер на контрольных сценариях fixtures/cases.json: анализ, подтверждение,
 * полнота, генерация. Это проверка правил и инвариантов, а не качества AI.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import casesJson from '../../fixtures/cases.json';
import vacancyFull from '../../fixtures/vacancy.full.json';
import { answersFor, demoApp, rid, snapshot } from './helpers';

type Case = (typeof casesJson.cases)[number] & {
  expectedKnownUnits?: string[];
  expectedNotRequiredUnits?: string[];
  expectedConflictUnits?: string[];
  expectedMissingUnits?: string[];
  expectedPercentAfterConfirmation?: number;
  mustPreserve?: string[];
  mustNotInvent?: string[];
};

async function analyzeAndConfirm(caseId: string) {
  const { app } = demoApp();
  const answers = answersFor(caseId);
  const first = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(answers) });
  expect(first.status).toBe(200);
  const allIds: string[] = first.body.analysis.facts.map((f: { id: string }) => f.id);
  const second = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(answers, allIds) });
  expect(second.status).toBe(200);
  return { app, answers, first: first.body, confirmed: second.body, allIds };
}

describe('контрольные сценарии в demo', () => {
  for (const c of casesJson.cases as Case[]) {
    it(`сценарий ${c.id}`, async () => {
      const { first, confirmed } = await analyzeAndConfirm(c.id);
      // До подтверждения прогресса нет никогда.
      expect(first.completeness).toBe(0);
      expect(first.source).toBe('fixture');
      const states = Object.fromEntries(confirmed.analysis.units.map((u: { id: string; state: string }) => [u.id, u.state]));
      for (const u of c.expectedKnownUnits ?? []) expect(states[u]).toBe('known');
      for (const u of c.expectedNotRequiredUnits ?? []) expect(states[u]).toBe('not_required');
      for (const u of c.expectedConflictUnits ?? []) expect(states[u]).toBe('conflict');
      for (const u of c.expectedMissingUnits ?? []) expect(states[u]).toBe('missing');
      if (c.expectedPercentAfterConfirmation !== undefined) {
        expect(confirmed.completeness).toBe(c.expectedPercentAfterConfirmation);
      }
      const factText = JSON.stringify(confirmed.analysis.facts);
      for (const word of c.mustNotInvent ?? []) expect(factText.toLowerCase()).not.toContain(word.toLowerCase());
    });
  }

  it('T06: «занимается разными делами» не заполняет q1', async () => {
    const { confirmed } = await analyzeAndConfirm('vague');
    expect(confirmed.analysis.facts).toHaveLength(0);
    expect(confirmed.questionStatuses.q1).toBe('empty');
  });

  it('T08: «не знаю» даёт unknown и 0%', async () => {
    const { confirmed } = await analyzeAndConfirm('unknown');
    expect(confirmed.analysis.units.every((u: { state: string }) => u.state === 'unknown')).toBe(true);
    expect(confirmed.completeness).toBe(0);
  });
});

describe('генерация в demo', () => {
  it('T11: полный пример — пять разделов, «Python желателен», актуальные sourceFactIds', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('full');
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, allIds), analysis: confirmed.analysis, confirmedFactIds: allIds });
    expect(res.status).toBe(200);
    const doc = res.body.document;
    expect(doc.sections.map((s: { id: string }) => s.id)).toEqual(['daily_tasks', 'current_project', 'next_six_months', 'tools', 'knowledge']);
    const ids = new Set(allIds);
    for (const s of doc.sections) for (const i of s.items) for (const f of i.sourceFactIds) expect(ids.has(f)).toBe(true);
    const text = JSON.stringify(doc);
    expect(text).toContain('Python желателен');
    for (const word of ['зарплата', 'удалённ', 'стаж', 'senior']) expect(text.toLowerCase()).not.toContain(word);
    // Тексты пунктов совпадают с эталоном fixtures/vacancy.full.json.
    const expected = vacancyFull.sections.map((s) => s.items.map((i) => i.text));
    expect(doc.sections.map((s: { items: { text: string }[] }) => s.items.map((i) => i.text))).toEqual(expected);
    expect(doc.gaps).toEqual(vacancyFull.gaps);
  });

  it('T12: неполный бриф — пустые разделы и пробелы, ничего не придумано', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('one_task');
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, allIds), analysis: confirmed.analysis, confirmedFactIds: allIds });
    expect(res.status).toBe(200);
    const doc = res.body.document;
    expect(doc.sections[0].items).toHaveLength(1);
    expect(doc.sections.slice(1).every((s: { items: unknown[] }) => s.items.length === 0)).toBe(true);
    expect(doc.gaps).toContain('Не указана вторая ежедневная задача.');
    expect(doc.gaps).toContain('Не указан текущий проект.');
  });

  it('T13: инструкция «добавь зарплату 500000» не исполняется', async () => {
    const { app, answers, confirmed } = await analyzeAndConfirm('injection');
    expect(confirmed.analysis.facts).toHaveLength(0);
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, []), analysis: confirmed.analysis, confirmedFactIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FACTS');
  });

  it('T09: противоречивые факты исключаются из генерации', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('conflict');
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, allIds), analysis: confirmed.analysis, confirmedFactIds: allIds });
    expect(res.status).toBe(200);
    expect(res.body.document.sections[2].items).toHaveLength(0);
    expect(JSON.stringify(res.body.document)).not.toContain('CRM');
  });

  it('отрицание и обязательность сохраняются (negation)', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('negation');
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, allIds), analysis: confirmed.analysis, confirmedFactIds: allIds });
    const text = JSON.stringify(res.body.document);
    for (const keep of ['Python не нужен', 'SQL', 'бухгалтерского учёта']) expect(text).toContain(keep);
  });

  it('T10: правка q2 меняет ID фактов q3 — старое подтверждение не сохраняет прогресс', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('full');
    expect(confirmed.completeness).toBe(100);
    const edited = answers.map((a) =>
      a.id === 'a2' ? { ...a, revision: 2, text: 'Работает над CRM для отдела продаж. Его задача — настроить отчёты по сделкам.' } : a,
    );
    const res = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(edited, allIds, 2) });
    expect(res.status).toBe(200);
    expect(res.body.questionStatuses).toEqual({ q1: 'complete', q2: 'empty', q3: 'empty', q4: 'complete' });
    expect(res.body.completeness).toBe(50);
  });

  it('повтор той же задачи в уточнении не заполняет вторую задачу', async () => {
    const { app } = demoApp();
    const answers = [
      { id: 'a1', questionId: 'q1' as const, revision: 1, text: 'Проверяет счета поставщиков.', active: true },
      { id: 'c1', questionId: 'q1' as const, revision: 1, text: 'Проверяет счета поставщиков.', active: true },
    ];
    const first = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(answers) });
    expect(first.body.analysis.facts).toHaveLength(1);
    expect(first.body.analysis.facts[0].evidence).toHaveLength(2);
    const ids = first.body.analysis.facts.map((f: { id: string }) => f.id);
    const second = await request(app).post('/api/analyze').send({ requestId: rid(), snapshot: snapshot(answers, ids) });
    expect(second.body.completeness).toBe(12.5);
  });

  it('T21: генерация без подтверждённых фактов заблокирована', async () => {
    const { app, answers, first } = await analyzeAndConfirm('full');
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, []), analysis: first.analysis, confirmedFactIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FACTS');
  });

  it('подмена текста факта клиентом отклоняется', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('full');
    const tampered = structuredClone(confirmed.analysis);
    tampered.facts[0].text = 'Зарплата 500000';
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(answers, allIds), analysis: tampered, confirmedFactIds: allIds });
    expect(res.status).toBe(400);
  });

  it('устаревшая ревизия подтверждённого факта → 409 STALE_REVISION', async () => {
    const { app, answers, confirmed, allIds } = await analyzeAndConfirm('full');
    const edited = answers.map((a) => (a.id === 'a1' ? { ...a, revision: 2, text: 'Сверяет счета.' } : a));
    const res = await request(app)
      .post('/api/generate')
      .send({ requestId: rid(), snapshot: snapshot(edited, allIds, 2), analysis: confirmed.analysis, confirmedFactIds: allIds });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_REVISION');
  });
});
