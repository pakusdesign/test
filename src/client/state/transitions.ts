/**
 * Чистые переходы состояния сессии. Побочные эффекты — в controller.ts.
 * Состояние хранится только в памяти вкладки (docs/04-architecture.md).
 */
import {
  completenessFromUnits,
  evaluateFacts,
  evaluateUnits,
  firstMissingUnit,
  type UnitEvaluation,
} from '../../shared/completeness';
import { LIMITS, QUESTION_IDS, type QuestionId, type UnitId } from '../../shared/constants';
import { editableEquals, toEditable, type EditableDocument } from '../../shared/markdown';
import type { Analysis, AnalyzeResponse, Fact, GenerateResponse, Snapshot } from '../../shared/schemas';
import type {
  ActionError,
  ActiveRequest,
  Answer,
  ClarificationState,
  ConfigState,
  InputMethod,
  InputTarget,
  SessionState,
  Stage,
} from './types';

export function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid.replace(/-/g, '').slice(0, 20)}`;
}

const perQuestion = <T,>(make: () => T): Record<QuestionId, T> => ({ q1: make(), q2: make(), q3: make(), q4: make() });
const freshClarification = (): ClarificationState => ({ offered: 0, activeUnit: null, dismissed: false });

export function initialState(config: ConfigState = { status: 'loading' }, demoScenarioId = 'guided'): SessionState {
  return {
    config,
    demoScenarioId,
    screen: 'start',
    questionIndex: 0,
    stage: 'ready',
    target: { kind: 'primary' },
    composerText: '',
    composerOrigin: 'user',
    recording: null,
    pendingAudio: null,
    sessionRevision: 0,
    factsRevision: 0,
    answers: [],
    drafts: {},
    analysis: null,
    analysisRevision: null,
    analysisSource: null,
    confirmedFactIds: [],
    excludedFactIds: [],
    answered: perQuestion(() => null),
    clarification: perQuestion(freshClarification),
    request: null,
    slow: false,
    error: null,
    connection: {
      browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      serviceUnreachable: false,
      recovered: false,
    },
    progressNote: null,
    document: null,
    modal: null,
    toast: null,
    selectExport: 0,
  };
}

/** S09: явная очистка — сброс фактов, версий, аудио, правок и прогресса. */
export function resetSession(s: SessionState): SessionState {
  const next = initialState(s.config, s.demoScenarioId);
  return { ...next, connection: s.connection };
}

export function currentQuestionId(s: SessionState): QuestionId {
  return QUESTION_IDS[s.questionIndex] ?? 'q1';
}

export function activeAnswersFor(s: SessionState, q: QuestionId): Answer[] {
  return s.answers.filter((a) => a.questionId === q && a.active);
}

export function snapshotOf(s: SessionState): Snapshot {
  return {
    sessionRevision: s.sessionRevision,
    answers: s.answers.map(({ id, questionId, revision, text, active }) => ({ id, questionId, revision, text, active })),
    confirmedFactIds: s.confirmedFactIds,
  };
}

export function unitsOf(s: SessionState): UnitEvaluation[] {
  return evaluateUnits(s.analysis, s.answers, s.confirmedFactIds);
}

export function completenessOf(s: SessionState): number {
  return completenessFromUnits(unitsOf(s));
}

/** Факты, которые показываются на экране вопроса: по вопросу и извлечённые из его ответов. */
export function factsInView(analysis: Analysis | null, answers: readonly Answer[], q: QuestionId): Fact[] {
  if (!analysis) return [];
  const answerQuestion = new Map(answers.map((a) => [a.id, a.questionId]));
  return analysis.facts.filter((f) => f.questionId === q || f.evidence.some((e) => answerQuestion.get(e.answerId) === q));
}

export function stageForQuestion(s: SessionState, q: QuestionId): Stage {
  if (activeAnswersFor(s, q).length > 0) return 'review';
  return 'ready';
}

export function goToQuestion(s: SessionState, index: number): SessionState {
  const bounded = Math.max(0, Math.min(QUESTION_IDS.length - 1, index));
  const q = QUESTION_IDS[bounded]!;
  return {
    ...s,
    screen: 'question',
    questionIndex: bounded,
    stage: stageForQuestion(s, q),
    target: { kind: 'primary' },
    composerText: '',
    composerOrigin: 'user',
    error: s.error && s.error.questionId === q ? s.error : null,
    progressNote: null,
  };
}

export function isAnalysisFresh(s: SessionState): boolean {
  return s.analysis !== null && s.analysisRevision === s.sessionRevision;
}

export function hasDirtyDrafts(s: SessionState, q: QuestionId): boolean {
  return activeAnswersFor(s, q).some((a) => s.drafts[a.id] !== undefined && s.drafts[a.id] !== a.text);
}

export interface CommitParams {
  questionId: QuestionId;
  target: InputTarget;
  text: string;
  inputMethod: InputMethod;
  origin: 'user' | 'fixture';
  /** Существующий ответ для правки (новая ревизия) или заранее выданный id новой записи. */
  answerId?: string;
}

/** Добавляет ответ или новую ревизию существующего. Любое изменение увеличивает sessionRevision. */
export function commitAnswer(s: SessionState, p: CommitParams): { state: SessionState; answerId: string } {
  const before = completenessOf(s);
  const existing = p.answerId ? s.answers.find((a) => a.id === p.answerId) : undefined;
  let answers: Answer[];
  let answerId: string;
  if (existing) {
    answerId = existing.id;
    answers = s.answers.map((a) =>
      a.id === existing.id ? { ...a, revision: a.revision + 1, text: p.text, inputMethod: p.inputMethod, origin: p.origin } : a,
    );
  } else {
    answerId = p.answerId ?? newId('ans');
    answers = [
      ...s.answers,
      {
        id: answerId,
        questionId: p.questionId,
        revision: 1,
        text: p.text,
        active: true,
        kind: p.target.kind,
        unitId: p.target.kind === 'clarification' ? p.target.unitId : null,
        inputMethod: p.inputMethod,
        origin: p.origin,
      },
    ];
  }
  const drafts = { ...s.drafts };
  delete drafts[answerId];
  let next: SessionState = {
    ...s,
    answers,
    drafts,
    sessionRevision: s.sessionRevision + 1,
    composerText: '',
    composerOrigin: 'user',
    target: { kind: 'primary' },
  };
  if (existing) {
    // Правка ответа требует повторной проверки этого вопроса.
    next = { ...next, answered: { ...next.answered, [p.questionId]: null } };
  }
  const after = completenessOf(next);
  if (after < before) next = { ...next, progressNote: 'Ответ изменён. Проверьте сведения ещё раз' };
  return { state: next, answerId };
}

export function beginRequest(
  s: SessionState,
  req: Omit<ActiveRequest, 'startedAt' | 'sessionRevision' | 'factsRevision'> & { startedAt?: number },
  stage?: Stage,
): SessionState {
  return {
    ...s,
    request: {
      ...req,
      startedAt: req.startedAt ?? Date.now(),
      sessionRevision: s.sessionRevision,
      factsRevision: s.factsRevision,
    },
    slow: false,
    error: null,
    stage: stage ?? s.stage,
  };
}

function offerClarification(s: SessionState, q: QuestionId, units: UnitEvaluation[]): SessionState {
  const c = s.clarification[q];
  const missing = firstMissingUnit(q, units);
  if (!missing || c.dismissed || c.offered >= LIMITS.maxClarificationsPerQuestion) {
    return { ...s, clarification: { ...s.clarification, [q]: { ...c, activeUnit: null } } };
  }
  return { ...s, clarification: { ...s.clarification, [q]: { ...c, activeUnit: missing.id, offered: c.offered + 1 } } };
}

/** Применяет анализ только для активного requestId и текущей ревизии (T17). */
export function applyAnalysis(s: SessionState, response: AnalyzeResponse): SessionState | null {
  if (!s.request || s.request.op !== 'analyze' || s.request.requestId !== response.requestId) return null;
  if (response.sessionRevision !== s.sessionRevision) return null;
  const ids = new Set(response.analysis.facts.map((f) => f.id));
  const q = s.request.questionId;
  let next: SessionState = {
    ...s,
    analysis: response.analysis,
    analysisRevision: response.sessionRevision,
    analysisSource: response.source,
    confirmedFactIds: s.confirmedFactIds.filter((id) => ids.has(id)),
    excludedFactIds: s.excludedFactIds.filter((id) => ids.has(id)),
    request: null,
    slow: false,
    error: null,
    stage: s.screen === 'question' ? stageForQuestion(s, currentQuestionId(s)) : s.stage,
    connection: { ...s.connection, serviceUnreachable: false, recovered: false },
  };
  if (q) {
    next = { ...next, clarification: { ...next.clarification, [q]: { ...next.clarification[q], activeUnit: null } } };
    // S05: текст есть, а сведений нет — сразу одно уточнение.
    if (factsInView(next.analysis, next.answers, q).length === 0 && activeAnswersFor(next, q).some((a) => a.text.trim())) {
      next = offerClarification(next, q, unitsOf(next));
    }
  }
  return next;
}

/** Завершает активный запрос ошибкой; поздний ответ другого запроса игнорируется. */
export function failRequest(s: SessionState, requestId: string, error: ActionError | null, networkFailure: boolean): SessionState | null {
  if (!s.request || s.request.requestId !== requestId) return null;
  return {
    ...s,
    request: null,
    slow: false,
    error,
    stage: s.screen === 'question' ? stageForQuestion(s, currentQuestionId(s)) : s.stage,
    connection: networkFailure ? { ...s.connection, serviceUnreachable: true } : s.connection,
  };
}

/** Подтверждение: включённые факты экрана вопроса фиксируются, исключённые снимаются. */
export function confirmQuestion(s: SessionState, q: QuestionId): SessionState {
  const before = completenessOf(s);
  const view = factsInView(s.analysis, s.answers, q);
  const evals = evaluateFacts(s.analysis, s.answers, s.confirmedFactIds);
  const viewIds = new Set(view.map((f) => f.id));
  const included = view
    .filter((f) => {
      const e = evals.get(f.id);
      return e && e.evidenceValid && !e.inConflict && !s.excludedFactIds.includes(f.id);
    })
    .map((f) => f.id);
  const confirmedFactIds = [...s.confirmedFactIds.filter((id) => !viewIds.has(id)), ...included];
  let next: SessionState = {
    ...s,
    confirmedFactIds,
    factsRevision: s.factsRevision + 1,
    answered: { ...s.answered, [q]: 'confirmed' },
    progressNote: null,
  };
  const units = unitsOf(next);
  if (completenessFromUnits(units) < before) next = { ...next, progressNote: 'Часть сведений исключена. Полнота снизилась' };
  return offerClarification(next, q, units);
}

export function setFactIncluded(s: SessionState, factId: string, included: boolean): SessionState {
  const excluded = s.excludedFactIds.filter((id) => id !== factId);
  return { ...s, excludedFactIds: included ? excluded : [...excluded, factId] };
}

export function dismissClarification(s: SessionState, q: QuestionId): SessionState {
  return {
    ...s,
    clarification: { ...s.clarification, [q]: { ...s.clarification[q], activeUnit: null, dismissed: true } },
    answered: { ...s.answered, [q]: s.answered[q] ?? 'skipped' },
  };
}

export function skipQuestion(s: SessionState, q: QuestionId): SessionState {
  return { ...dismissClarification(s, q), answered: { ...s.answered, [q]: s.answered[q] ?? 'skipped' } };
}

/** Разрешение противоречия: старые ответы помечаются неактуальными (superseded). */
export function supersedeAnswers(s: SessionState, answerIds: readonly string[]): SessionState {
  if (answerIds.length === 0) return s;
  const before = completenessOf(s);
  const touched = new Set(s.answers.filter((a) => answerIds.includes(a.id)).map((a) => a.questionId));
  let next: SessionState = {
    ...s,
    answers: s.answers.map((a) => (answerIds.includes(a.id) ? { ...a, active: false } : a)),
    sessionRevision: s.sessionRevision + 1,
  };
  for (const q of touched) next = { ...next, answered: { ...next.answered, [q]: null } };
  if (completenessOf(next) < before) next = { ...next, progressNote: 'Ответ отмечен неактуальным. Проверьте сведения' };
  return next;
}

export function applyDocument(s: SessionState, response: GenerateResponse): SessionState | null {
  if (!s.request || s.request.op !== 'generate' || s.request.requestId !== response.requestId) return null;
  if (response.sessionRevision !== s.request.sessionRevision) return null;
  return {
    ...s,
    request: null,
    slow: false,
    error: null,
    screen: 'result',
    document: {
      generatedAtRevision: response.sessionRevision,
      generatedAtFactsRevision: s.request.factsRevision,
      generated: response.document,
      edited: toEditable(response.document),
      isManuallyEdited: false,
      source: response.source,
    },
    connection: { ...s.connection, serviceUnreachable: false, recovered: false },
  };
}

export function isDocumentStale(s: SessionState): boolean {
  return (
    s.document !== null &&
    (s.document.generatedAtRevision !== s.sessionRevision || s.document.generatedAtFactsRevision !== s.factsRevision)
  );
}

export function editDocument(s: SessionState, update: (doc: EditableDocument) => EditableDocument): SessionState {
  if (!s.document) return s;
  const edited = update(s.document.edited);
  return {
    ...s,
    document: {
      ...s.document,
      edited,
      isManuallyEdited: !editableEquals(edited, toEditable(s.document.generated)),
    },
  };
}

export function unitLabelReason(unit: UnitEvaluation): string {
  switch (unit.reason) {
    case 'valid':
      return 'Подтверждено';
    case 'unconfirmed':
      return 'Ждёт подтверждения';
    case 'stale_source':
      return 'Ответ изменён — нужна проверка';
    case 'dependency':
      return 'Зависит от неподтверждённого или изменённого ответа';
    case 'conflict':
      return 'Есть противоречие';
    case 'unknown':
      return 'Указано «не знаю»';
    case 'not_allowed':
      return 'Недопустимое «не требуется»';
    default:
      return 'Нет сведений';
  }
}

export type { UnitId };
