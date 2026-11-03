import { describe, expect, it } from 'vitest';
import analysisFull from '../../fixtures/analysis.full.json';
import casesJson from '../../fixtures/cases.json';
import { UNIT_IDS } from '../../src/shared/constants';
import type { Analysis, AnalyzeResponse, GenerateResponse } from '../../src/shared/schemas';
import vacancyFull from '../../fixtures/vacancy.full.json';
import {
  applyAnalysis,
  applyDocument,
  beginRequest,
  commitAnswer,
  completenessOf,
  confirmQuestion,
  editDocument,
  failRequest,
  initialState,
  isDocumentStale,
  resetSession,
  setFactIncluded,
  supersedeAnswers,
} from '../../src/client/state/transitions';
import type { SessionState } from '../../src/client/state/types';

const full = analysisFull as Analysis;
const texts = casesJson.cases[0]!.answers;

function withAnswers(): SessionState {
  let s = initialState({ status: 'loading' });
  texts.forEach((text, i) => {
    s = commitAnswer(s, {
      questionId: (['q1', 'q2', 'q3', 'q4'] as const)[i]!,
      target: { kind: 'primary' },
      text,
      inputMethod: 'text',
      origin: 'user',
      answerId: `a${i + 1}`,
    }).state;
  });
  return s;
}

function analyzed(): SessionState {
  const s = beginRequest(withAnswers(), { requestId: 'req-00000001', op: 'analyze', questionId: 'q1', returnStage: 'review' });
  const response: AnalyzeResponse = {
    schemaVersion: '1.0',
    requestId: 'req-00000001',
    sessionRevision: s.sessionRevision,
    analysis: full,
    completeness: 0,
    questionStatuses: { q1: 'empty', q2: 'empty', q3: 'empty', q4: 'empty' },
    source: 'fixture',
  };
  return applyAnalysis(s, response)!;
}

describe('переходы сессии', () => {
  it('каждый ответ увеличивает sessionRevision; правка — новая ревизия того же answerId', () => {
    const s = withAnswers();
    expect(s.sessionRevision).toBe(4);
    const { state, answerId } = commitAnswer(s, { questionId: 'q1', target: { kind: 'primary' }, text: 'Новый текст', inputMethod: 'text', origin: 'user', answerId: 'a1' });
    expect(answerId).toBe('a1');
    expect(state.answers.filter((a) => a.questionId === 'q1')).toHaveLength(1);
    expect(state.answers[0]!.revision).toBe(2);
    expect(state.sessionRevision).toBe(5);
  });

  it('T04: анализ не меняет прогресс; подтверждение — меняет', () => {
    const s = analyzed();
    expect(completenessOf(s)).toBe(0);
    const c = confirmQuestion(s, 'q1');
    expect(completenessOf(c)).toBe(25);
    expect(c.answered.q1).toBe('confirmed');
  });

  it('T17: поздний ответ другого requestId или старой ревизии не применяется', () => {
    const s = beginRequest(withAnswers(), { requestId: 'req-new-0001', op: 'analyze', questionId: 'q1', returnStage: 'review' });
    const stale: AnalyzeResponse = {
      schemaVersion: '1.0',
      requestId: 'req-old-0001',
      sessionRevision: s.sessionRevision,
      analysis: full,
      completeness: 0,
      questionStatuses: { q1: 'empty', q2: 'empty', q3: 'empty', q4: 'empty' },
      source: 'fixture',
    };
    expect(applyAnalysis(s, stale)).toBeNull();
    expect(applyAnalysis(s, { ...stale, requestId: 'req-new-0001', sessionRevision: s.sessionRevision - 1 })).toBeNull();
    expect(failRequest(s, 'req-old-0001', null, true)).toBeNull();
  });

  it('исключённый факт снимает подтверждение и может снизить полноту', () => {
    const s = confirmQuestion(analyzed(), 'q1');
    const excluded = confirmQuestion(setFactIncluded(s, 'f1', false), 'q1');
    expect(completenessOf(excluded)).toBe(12.5);
    expect(excluded.progressNote).toMatch(/Полнота снизилась/);
  });

  it('уточнение: первая незаполненная единица, не больше двух на вопрос', () => {
    let s = analyzed();
    s = setFactIncluded(s, 'f2', false);
    s = confirmQuestion(s, 'q1');
    expect(s.clarification.q1).toMatchObject({ activeUnit: 'q1.task2', offered: 1 });
    s = confirmQuestion(s, 'q1');
    expect(s.clarification.q1.offered).toBe(2);
    s = confirmQuestion(s, 'q1');
    expect(s.clarification.q1).toMatchObject({ activeUnit: null, offered: 2 });
  });

  it('правка ответа после подтверждения: прогресс снижается, вопрос снова требует проверки', () => {
    let s = confirmQuestion(analyzed(), 'q1');
    s = commitAnswer(s, { questionId: 'q1', target: { kind: 'primary' }, text: 'Сверяет счета.', inputMethod: 'text', origin: 'user', answerId: 'a1' }).state;
    expect(completenessOf(s)).toBe(0);
    expect(s.answered.q1).toBeNull();
    expect(s.progressNote).toBe('Ответ изменён. Проверьте сведения ещё раз');
  });

  it('superseded-ответ выходит из анализа', () => {
    let s = analyzed();
    for (const q of ['q1', 'q2', 'q3', 'q4'] as const) s = confirmQuestion(s, q);
    expect(completenessOf(s)).toBe(100);
    s = supersedeAnswers(s, ['a4']);
    expect(completenessOf(s)).toBe(75);
    expect(s.answers.find((a) => a.id === 'a4')!.active).toBe(false);
  });

  it('документ: ручная правка отмечается; изменение ответов делает его устаревшим', () => {
    let s = analyzed();
    for (const q of ['q1', 'q2', 'q3', 'q4'] as const) s = confirmQuestion(s, q);
    s = beginRequest(s, { requestId: 'req-gen-0001', op: 'generate', questionId: null, returnStage: 'review' });
    const response: GenerateResponse = { schemaVersion: '1.0', requestId: 'req-gen-0001', sessionRevision: s.sessionRevision, document: vacancyFull as never, source: 'fixture' };
    s = applyDocument(s, response)!;
    expect(s.screen).toBe('result');
    expect(isDocumentStale(s)).toBe(false);
    s = editDocument(s, (d) => ({ ...d, title: 'Аналитик платежей' }));
    expect(s.document!.isManuallyEdited).toBe(true);
    s = editDocument(s, (d) => ({ ...d, title: 'Описание вакансии' }));
    expect(s.document!.isManuallyEdited).toBe(false);
    s = commitAnswer(s, { questionId: 'q1', target: { kind: 'clarification', unitId: null }, text: 'Ещё сверяет акты.', inputMethod: 'text', origin: 'user' }).state;
    expect(isDocumentStale(s)).toBe(true);
  });

  it('S09: очистка сбрасывает ответы, факты, правки и прогресс', () => {
    let s = confirmQuestion(analyzed(), 'q1');
    s = resetSession(s);
    expect(s.answers).toHaveLength(0);
    expect(s.confirmedFactIds).toHaveLength(0);
    expect(s.sessionRevision).toBe(0);
    expect(s.screen).toBe('start');
    expect(UNIT_IDS.length).toBe(8);
  });
});
