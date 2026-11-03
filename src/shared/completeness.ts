/**
 * Чистые функции смысловой полноты (docs/03-semantics.md).
 * Используются сервером (ответ /api/analyze, проверка перед генерацией)
 * и клиентом (подтверждение, круг). Модель процент не вычисляет.
 */
import {
  NOT_REQUIRED_ALLOWED,
  QUESTION_IDS,
  QUESTIONS,
  UNIT_IDS,
  UNIT_QUESTION,
  type QuestionId,
  type UnitId,
  type UnitState,
} from './constants';
import type { Analysis, Evidence, Fact, QuestionStatus } from './schemas';

export interface AnswerRef {
  id: string;
  questionId: QuestionId;
  revision: number;
  text: string;
  active: boolean;
}

/** Нормализация для поиска цитаты: Unicode NFC, пробелы, регистр. Буквы не заменяются. */
export function normalizeForQuote(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
}

export function quoteFoundIn(quote: string, text: string): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(text).includes(q);
}

export type EvidenceIssue = 'answer_missing' | 'answer_inactive' | 'revision_mismatch' | 'quote_not_found';

export function checkEvidence(evidence: Evidence, answersById: ReadonlyMap<string, AnswerRef>): EvidenceIssue | null {
  const answer = answersById.get(evidence.answerId);
  if (!answer) return 'answer_missing';
  if (!answer.active) return 'answer_inactive';
  if (answer.revision !== evidence.answerRevision) return 'revision_mismatch';
  if (!quoteFoundIn(evidence.quote, answer.text)) return 'quote_not_found';
  return null;
}

export function indexAnswers(answers: readonly AnswerRef[]): Map<string, AnswerRef> {
  return new Map(answers.map((a) => [a.id, a]));
}

export type FactStatus =
  | 'usable'
  | 'unconfirmed'
  | 'stale_source'
  | 'conflict'
  | 'dependency'
  | 'invalid';

export interface FactEvaluation {
  status: FactStatus;
  evidenceValid: boolean;
  confirmed: boolean;
  inConflict: boolean;
  dependenciesUsable: boolean;
}

/**
 * Статус каждого факта. usable = источник актуален, факт подтверждён,
 * не участвует в противоречии, все зависимости тоже usable.
 */
export function evaluateFacts(
  analysis: Analysis | null,
  answers: readonly AnswerRef[],
  confirmedFactIds: Iterable<string>,
): Map<string, FactEvaluation> {
  const result = new Map<string, FactEvaluation>();
  if (!analysis) return result;
  const confirmed = new Set(confirmedFactIds);
  const answersById = indexAnswers(answers);
  const factsById = new Map(analysis.facts.map((f) => [f.id, f]));
  const conflicted = new Set(analysis.conflicts.flatMap((c) => c.factIds));

  const base = new Map<string, Omit<FactEvaluation, 'status' | 'dependenciesUsable'>>();
  for (const fact of analysis.facts) {
    base.set(fact.id, {
      evidenceValid: fact.evidence.length > 0 && fact.evidence.every((e) => checkEvidence(e, answersById) === null),
      confirmed: confirmed.has(fact.id),
      inConflict: conflicted.has(fact.id),
    });
  }

  const usableMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isUsable = (id: string): boolean => {
    const memo = usableMemo.get(id);
    if (memo !== undefined) return memo;
    const fact = factsById.get(id);
    const b = base.get(id);
    if (!fact || !b || visiting.has(id)) return false; // нет факта или цикл
    visiting.add(id);
    const depsOk = fact.dependsOn.every((d) => d !== id && isUsable(d));
    visiting.delete(id);
    const ok = b.evidenceValid && b.confirmed && !b.inConflict && depsOk;
    usableMemo.set(id, ok);
    return ok;
  };

  for (const fact of analysis.facts) {
    const b = base.get(fact.id)!;
    const depsUsable = fact.dependsOn.every((d) => d !== fact.id && isUsable(d));
    let status: FactStatus;
    if (!b.evidenceValid) status = 'stale_source';
    else if (b.inConflict) status = 'conflict';
    else if (!depsUsable && fact.dependsOn.some((d) => !factsById.has(d))) status = 'invalid';
    else if (!b.confirmed) status = 'unconfirmed';
    else if (!depsUsable) status = 'dependency';
    else status = 'usable';
    result.set(fact.id, { ...b, dependenciesUsable: depsUsable, status });
  }
  return result;
}

export type UnitReason =
  | 'valid'
  | 'missing'
  | 'unknown'
  | 'conflict'
  | 'not_allowed'
  | 'no_facts'
  | 'fact_missing'
  | 'wrong_question'
  | 'stale_source'
  | 'dependency'
  | 'unconfirmed';

export interface UnitEvaluation {
  id: UnitId;
  questionId: QuestionId;
  state: UnitState;
  valid: boolean;
  reason: UnitReason;
  factIds: string[];
}

/**
 * Единица даёт 1, если её состояние known (или разрешённое not_required),
 * хотя бы один связанный факт usable и ни один связанный факт не в противоречии.
 * Исключённые пользователем (неподтверждённые) факты прогресс не дают.
 */
export function evaluateUnits(
  analysis: Analysis | null,
  answers: readonly AnswerRef[],
  confirmedFactIds: Iterable<string>,
): UnitEvaluation[] {
  const facts = evaluateFacts(analysis, answers, confirmedFactIds);
  const factsById = new Map((analysis?.facts ?? []).map((f) => [f.id, f]));

  return UNIT_IDS.map((id): UnitEvaluation => {
    const questionId = UNIT_QUESTION[id];
    const unit = analysis?.units.find((u) => u.id === id);
    const make = (valid: boolean, reason: UnitReason): UnitEvaluation => ({
      id,
      questionId,
      state: unit?.state ?? 'missing',
      valid,
      reason,
      factIds: unit?.factIds ?? [],
    });
    if (!unit || unit.state === 'missing') return make(false, 'missing');
    if (unit.state === 'unknown') return make(false, 'unknown');
    if (unit.state === 'conflict') return make(false, 'conflict');
    if (unit.state === 'not_required' && !NOT_REQUIRED_ALLOWED.includes(id)) return make(false, 'not_allowed');
    if (unit.factIds.length === 0) return make(false, 'no_facts');
    const linked = unit.factIds.map((fid) => factsById.get(fid));
    if (linked.some((f) => !f)) return make(false, 'fact_missing');
    if ((linked as Fact[]).some((f) => f.questionId !== questionId)) return make(false, 'wrong_question');
    const evals = unit.factIds.map((fid) => facts.get(fid)!);
    if (evals.some((e) => e.inConflict)) return make(false, 'conflict');
    if (evals.some((e) => e.status === 'usable')) return make(true, 'valid');
    if (evals.every((e) => e.status === 'stale_source')) return make(false, 'stale_source');
    if (evals.some((e) => e.status === 'dependency' || e.status === 'invalid')) return make(false, 'dependency');
    if (evals.some((e) => e.status === 'stale_source')) return make(false, 'stale_source');
    return make(false, 'unconfirmed');
  });
}

export function completenessFromUnits(units: readonly { valid: boolean }[]): number {
  return (100 * units.filter((u) => u.valid).length) / UNIT_IDS.length;
}

/** Восемь булевых значений в фиксированном порядке UNIT_IDS — вход для круга. */
export function validUnitVector(units: readonly UnitEvaluation[]): boolean[] {
  return UNIT_IDS.map((id) => units.find((u) => u.id === id)?.valid ?? false);
}

export function completenessFromVector(vector: readonly boolean[]): number {
  return (100 * vector.filter(Boolean).length) / UNIT_IDS.length;
}

export function questionStatuses(units: readonly UnitEvaluation[]): Record<QuestionId, QuestionStatus> {
  const out = {} as Record<QuestionId, QuestionStatus>;
  for (const q of QUESTION_IDS) {
    const count = QUESTIONS[q].units.filter((id) => units.find((u) => u.id === id)?.valid).length;
    out[q] = count === 0 ? 'empty' : count === 1 ? 'partial' : 'complete';
  }
  return out;
}

/** Факты, которые разрешено передать в генерацию. */
export function usableFacts(
  analysis: Analysis | null,
  answers: readonly AnswerRef[],
  confirmedFactIds: Iterable<string>,
): Fact[] {
  if (!analysis) return [];
  const evals = evaluateFacts(analysis, answers, confirmedFactIds);
  return analysis.facts.filter((f) => evals.get(f.id)?.status === 'usable');
}

/** Первая незаполненная единица вопроса — основа уточнения (semantics). */
export function firstMissingUnit(questionId: QuestionId, units: readonly UnitEvaluation[]): UnitEvaluation | null {
  for (const id of QUESTIONS[questionId].units) {
    const u = units.find((x) => x.id === id);
    if (u && !u.valid) return u;
  }
  return null;
}

/** Округление для отображения: 12.5 → 13, 62.5 → 63 (Math.round по MOT03). */
export function displayPercent(value: number): number {
  return Math.round(value);
}

/** Карта факт → единицы, где он используется. */
export function unitsByFact(analysis: Analysis | null): Map<string, UnitId[]> {
  const map = new Map<string, UnitId[]>();
  for (const unit of analysis?.units ?? []) {
    for (const fid of unit.factIds) {
      const list = map.get(fid) ?? [];
      list.push(unit.id);
      map.set(fid, list);
    }
  }
  return map;
}
