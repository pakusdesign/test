import { describe, expect, it } from 'vitest';
import analysisFull from '../../fixtures/analysis.full.json';
import vacancyFull from '../../fixtures/vacancy.full.json';
import casesJson from '../../fixtures/cases.json';
import type { AnswerRef } from '../../src/shared/completeness';
import { AnalysisSchema, VacancyDocumentSchema, type Analysis } from '../../src/shared/schemas';
import {
  findDependencyCycle,
  findInventedContent,
  validateAnalysisRelations,
  validateDocumentRelations,
} from '../../src/shared/validation';

const full = AnalysisSchema.parse(analysisFull);
const answers: AnswerRef[] = casesJson.cases[0]!.answers.map((text, i) => ({
  id: `a${i + 1}`,
  questionId: (['q1', 'q2', 'q3', 'q4'] as const)[i]!,
  revision: 1,
  text,
  active: true,
}));
const clone = (): Analysis => structuredClone(full);

describe('проверка связей анализа', () => {
  it('полный пример валиден', () => {
    expect(validateAnalysisRelations(full, answers)).toEqual([]);
  });

  it('чужая цитата отклоняется', () => {
    const a = clone();
    a.facts[0]!.evidence[0]!.quote = 'зарплата 500000';
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('quote_not_found'))).toBe(true);
  });

  it('несуществующий factId отклоняется', () => {
    const a = clone();
    a.units[0]!.factIds = ['nope'];
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('nope'))).toBe(true);
  });

  it('старая ревизия источника отклоняется', () => {
    const a = clone();
    a.facts[0]!.evidence[0]!.answerRevision = 2;
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('revision_mismatch'))).toBe(true);
  });

  it('not_required для q1 отклоняется', () => {
    const a = clone();
    a.units[0]!.state = 'not_required';
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('not_required'))).toBe(true);
  });

  it('known без фактов отклоняется', () => {
    const a = clone();
    a.units[2]!.factIds = [];
    expect(validateAnalysisRelations(a, answers).length).toBeGreaterThan(0);
  });

  it('цикл dependsOn обнаруживается', () => {
    const a = clone();
    a.facts[2]!.dependsOn = ['f5'];
    expect(findDependencyCycle(a.facts)).not.toBeNull();
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('Цикл'))).toBe(true);
  });

  it('факт другого вопроса в единице отклоняется', () => {
    const a = clone();
    a.units[0]!.factIds = ['f3'];
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('относится'))).toBe(true);
  });

  it('один факт в q1.task1 и q1.task2 отклоняется', () => {
    const a = clone();
    a.units[1]!.factIds = ['f1'];
    expect(validateAnalysisRelations(a, answers).some((i) => i.message.includes('отличаться'))).toBe(true);
  });

  it('дубли единиц отклоняются', () => {
    const a = clone();
    a.units[1] = { ...a.units[0]! };
    expect(validateAnalysisRelations(a, answers).length).toBeGreaterThan(0);
  });
});

describe('проверка документа', () => {
  const doc = VacancyDocumentSchema.parse(vacancyFull);

  it('полный пример документа валиден', () => {
    expect(validateDocumentRelations(doc, full.facts)).toEqual([]);
  });

  it('ссылка на неподтверждённый факт отклоняется', () => {
    const allowed = full.facts.filter((f) => f.id !== 'f9');
    expect(validateDocumentRelations(doc, allowed).some((i) => i.message.includes('f9'))).toBe(true);
  });

  it('выдуманная зарплата, стаж и уровень обнаруживаются', () => {
    const bad = structuredClone(doc);
    bad.sections[0]!.items.push({ text: 'Ищем senior аналитика с опытом от трёх лет на удалённую работу', sourceFactIds: ['f1'] });
    bad.sections[3]!.items.push({ text: 'Зарплата 500000', sourceFactIds: ['f7'] });
    const labels = findInventedContent(bad, full.facts).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['уровень', 'стаж', 'формат работы', 'зарплата', 'число 500000']));
  });

  it('заголовок с должностью без источника отклоняется', () => {
    const bad = structuredClone(doc);
    bad.title.text = 'Аналитик данных';
    expect(validateDocumentRelations(bad, full.facts).some((i) => i.path === 'title')).toBe(true);
  });

  it('раздел дважды отклоняется', () => {
    const bad = structuredClone(doc);
    bad.sections[4] = { ...bad.sections[0]! };
    expect(validateDocumentRelations(bad, full.facts).length).toBeGreaterThan(0);
  });
});
