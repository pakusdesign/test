import { describe, expect, it } from 'vitest';
import analysisFull from '../../fixtures/analysis.full.json';
import casesJson from '../../fixtures/cases.json';
import {
  completenessFromUnits,
  displayPercent,
  evaluateFacts,
  evaluateUnits,
  firstMissingUnit,
  questionStatuses,
  quoteFoundIn,
  usableFacts,
  validUnitVector,
  type AnswerRef,
} from '../../src/shared/completeness';
import { UNIT_IDS } from '../../src/shared/constants';
import { AnalysisSchema, type Analysis } from '../../src/shared/schemas';

const full = AnalysisSchema.parse(analysisFull);
const fullCase = casesJson.cases.find((c) => c.id === 'full')!;
const answers: AnswerRef[] = fullCase.answers.map((text, i) => ({
  id: `a${i + 1}`,
  questionId: (['q1', 'q2', 'q3', 'q4'] as const)[i]!,
  revision: 1,
  text,
  active: true,
}));
const allFactIds = full.facts.map((f) => f.id);

function confirmUnits(analysis: Analysis, unitIds: string[]): string[] {
  return analysis.units.filter((u) => unitIds.includes(u.id)).flatMap((u) => u.factIds);
}

describe('полнота: 0 / 50 / 100%', () => {
  it('без подтверждений — 0%', () => {
    const units = evaluateUnits(full, answers, []);
    expect(completenessFromUnits(units)).toBe(0);
    expect(units.every((u) => u.reason === 'unconfirmed')).toBe(true);
  });

  it('четыре единицы q1+q2 — 50%', () => {
    const units = evaluateUnits(full, answers, confirmUnits(full, ['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution']));
    expect(completenessFromUnits(units)).toBe(50);
    expect(questionStatuses(units)).toEqual({ q1: 'complete', q2: 'complete', q3: 'empty', q4: 'empty' });
  });

  it('все факты — 100%', () => {
    const units = evaluateUnits(full, answers, allFactIds);
    expect(completenessFromUnits(units)).toBe(100);
    expect(validUnitVector(units)).toEqual(Array(8).fill(true));
  });

  it('одна единица — 12.5%, отображается 13', () => {
    const units = evaluateUnits(full, answers, confirmUnits(full, ['q1.task1']));
    const value = completenessFromUnits(units);
    expect(value).toBe(12.5);
    expect(displayPercent(value)).toBe(13);
    expect(displayPercent(37.5)).toBe(38);
    expect(displayPercent(62.5)).toBe(63);
    expect(displayPercent(87.5)).toBe(88);
  });

  it('разреженное заполнение: q2 и q4 без q1 и q3 — вектор не уплотняется', () => {
    const units = evaluateUnits(full, answers, confirmUnits(full, ['q2.project', 'q2.contribution', 'q4.tools', 'q4.knowledge']));
    expect(validUnitVector(units)).toEqual([false, false, true, true, false, false, true, true]);
    expect(completenessFromUnits(units)).toBe(50);
  });

  it('q3 без подтверждённого q2 не засчитывается (зависимость)', () => {
    const units = evaluateUnits(full, answers, confirmUnits(full, ['q3.direction', 'q3.project']));
    expect(units.find((u) => u.id === 'q3.project')!.reason).toBe('dependency');
    expect(completenessFromUnits(units)).toBe(0);
  });
});

describe('unknown, not_required, conflict', () => {
  const base = (units: Analysis['units'], facts: Analysis['facts'] = [], conflicts: Analysis['conflicts'] = []): Analysis => ({
    facts,
    units: UNIT_IDS.map((id) => units.find((u) => u.id === id) ?? { id, state: 'missing', factIds: [] }),
    conflicts,
  });

  it('unknown не даёт прогресс', () => {
    const analysis = base([{ id: 'q1.task1', state: 'unknown', factIds: [] }]);
    const units = evaluateUnits(analysis, [], []);
    expect(units[0]!.reason).toBe('unknown');
    expect(completenessFromUnits(units)).toBe(0);
  });

  it('not_required допустим только для q4', () => {
    const answersQ = [
      { id: 'x1', questionId: 'q1' as const, revision: 1, text: 'Специальных задач нет', active: true },
      { id: 'x4', questionId: 'q4' as const, revision: 1, text: 'Специальные программы и знания не нужны.', active: true },
    ];
    const facts: Analysis['facts'] = [
      { id: 'n1', questionId: 'q1', kind: 'task', text: 'Нет задач', evidence: [{ answerId: 'x1', answerRevision: 1, quote: 'задач нет' }], dependsOn: [] },
      { id: 'n4', questionId: 'q4', kind: 'tool', text: 'Не нужны', evidence: [{ answerId: 'x4', answerRevision: 1, quote: 'программы и знания не нужны' }], dependsOn: [] },
      { id: 'n5', questionId: 'q4', kind: 'knowledge', text: 'Не нужны', evidence: [{ answerId: 'x4', answerRevision: 1, quote: 'знания не нужны' }], dependsOn: [] },
    ];
    const analysis = base(
      [
        { id: 'q1.task1', state: 'not_required', factIds: ['n1'] },
        { id: 'q4.tools', state: 'not_required', factIds: ['n4'] },
        { id: 'q4.knowledge', state: 'not_required', factIds: ['n5'] },
      ],
      facts,
    );
    const units = evaluateUnits(analysis, answersQ, ['n1', 'n4', 'n5']);
    expect(units.find((u) => u.id === 'q1.task1')!.reason).toBe('not_allowed');
    expect(completenessFromUnits(units)).toBe(25);
  });

  it('conflict блокирует связанные единицы и исключает факты из генерации', () => {
    const answersQ = [
      { id: 'c3', questionId: 'q3' as const, revision: 1, text: 'Продолжит платёжный модуль. Перейдёт на CRM.', active: true },
    ];
    const facts: Analysis['facts'] = [
      { id: 'k1', questionId: 'q3', kind: 'direction', text: 'Продолжить', evidence: [{ answerId: 'c3', answerRevision: 1, quote: 'Продолжит платёжный модуль' }], dependsOn: [] },
      { id: 'k2', questionId: 'q3', kind: 'direction', text: 'Перейти', evidence: [{ answerId: 'c3', answerRevision: 1, quote: 'Перейдёт на CRM' }], dependsOn: [] },
    ];
    const analysis = base(
      [
        { id: 'q3.direction', state: 'known', factIds: ['k1'] },
        { id: 'q3.project', state: 'conflict', factIds: ['k1', 'k2'] },
      ],
      facts,
      [{ factIds: ['k1', 'k2'], description: 'два плана' }],
    );
    const units = evaluateUnits(analysis, answersQ, ['k1', 'k2']);
    expect(units.find((u) => u.id === 'q3.direction')!.reason).toBe('conflict');
    expect(units.find((u) => u.id === 'q3.project')!.reason).toBe('conflict');
    expect(usableFacts(analysis, answersQ, ['k1', 'k2'])).toHaveLength(0);
  });
});

describe('инвалидация после правки', () => {
  it('новая ревизия ответа гасит только его факты', () => {
    const edited = answers.map((a) => (a.id === 'a1' ? { ...a, revision: 2, text: 'Сверяет счета.' } : a));
    const units = evaluateUnits(full, edited, allFactIds);
    expect(units.find((u) => u.id === 'q1.task1')!.reason).toBe('stale_source');
    expect(units.find((u) => u.id === 'q1.task2')!.reason).toBe('stale_source');
    expect(completenessFromUnits(units)).toBe(75);
  });

  it('правка q2 снимает прогресс q3, который зависит от проекта', () => {
    const edited = answers.map((a) => (a.id === 'a2' ? { ...a, revision: 2, text: 'Работает над CRM.' } : a));
    const units = evaluateUnits(full, edited, allFactIds);
    expect(units.find((u) => u.id === 'q3.direction')!.reason).toBe('dependency');
    expect(units.find((u) => u.id === 'q3.project')!.reason).toBe('dependency');
    expect(completenessFromUnits(units)).toBe(50);
  });

  it('неактивный (superseded) ответ не служит источником', () => {
    const inactive = answers.map((a) => (a.id === 'a4' ? { ...a, active: false } : a));
    const evals = evaluateFacts(full, inactive, allFactIds);
    expect(evals.get('f7')!.status).toBe('stale_source');
  });

  it('исключённый пользователем факт не даёт прогресс, но второй факт единицы сохраняет её', () => {
    const withoutPython = allFactIds.filter((id) => id !== 'f9');
    expect(evaluateUnits(full, answers, withoutPython).find((u) => u.id === 'q4.tools')!.valid).toBe(true);
    const withoutTools = allFactIds.filter((id) => id !== 'f7' && id !== 'f9');
    expect(evaluateUnits(full, answers, withoutTools).find((u) => u.id === 'q4.tools')!.valid).toBe(false);
  });
});

describe('цитаты и уточнения', () => {
  it('цитата ищется без учёта регистра и лишних пробелов, но дословно', () => {
    expect(quoteFoundIn('Анализирует  отказы оплаты', fullCase.answers[0]!)).toBe(true);
    expect(quoteFoundIn('анализирует отказы платежей', fullCase.answers[0]!)).toBe(false);
    expect(quoteFoundIn('', 'текст')).toBe(false);
  });

  it('первая незаполненная единица вопроса определяет уточнение', () => {
    const units = evaluateUnits(full, answers, confirmUnits(full, ['q1.task1']));
    expect(firstMissingUnit('q1', units)!.id).toBe('q1.task2');
    expect(firstMissingUnit('q2', units)!.id).toBe('q2.project');
    const all = evaluateUnits(full, answers, allFactIds);
    expect(firstMissingUnit('q1', all)).toBeNull();
  });
});
