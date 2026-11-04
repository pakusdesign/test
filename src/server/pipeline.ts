/**
 * Обработка анализа и генерации: вызов провайдера в бюджете, проверка схемы
 * и связей, один repair-вызов, серверные ID, расчёт полноты.
 */
import {
  completenessFromUnits,
  evaluateUnits,
  questionStatuses,
  usableFacts,
  checkEvidence,
  normalizeForQuote,
  quoteFoundIn,
  type AnswerRef,
} from '../shared/completeness';
import { UNIT_IDS } from '../shared/constants';
import { computeGaps } from '../shared/gaps';
import {
  AnalysisSchema,
  VacancyDocumentSchema,
  type Analysis,
  type Fact,
  type QuestionStatus,
  type Snapshot,
  type VacancyDocument,
} from '../shared/schemas';
import { orderSections, validateAnalysisRelations, validateDocumentRelations } from '../shared/validation';
import { callWithBudget, type Budget } from './budget';
import { AppError } from './errors';
import { assignServerIds, findTamperedFactIds } from './factIds';
import type { Analyzer, Generator, ModelOutput, RepairRequest } from './providers/types';

export interface PipelineMeta {
  attempts: number;
  repaired: boolean;
}

function emptyAnalysis(): Analysis {
  return { facts: [], units: UNIT_IDS.map((id) => ({ id, state: 'missing' as const, factIds: [] })), conflicts: [] };
}

function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.slice(0, 20).map((i) => `${i.path.map(String).join('.') || '(корень)'}: ${i.message}`);
}

/** Для лога — только пути нарушений, без текста пользователя или модели. */
function issuePaths(issues: string[] | undefined): string {
  return (issues ?? []).slice(0, 5).map((i) => i.split(':')[0]).join(' | ');
}

export function activeAnswers(snapshot: Snapshot): AnswerRef[] {
  return snapshot.answers.filter((a) => a.active);
}

/** Не даёт одной фразе закрыть несвязанные вопросы. Пропуски остаются пропусками. */
function pruneRepeatedFacts(analysis: Analysis, answers: readonly AnswerRef[]): Analysis {
  const answerById = new Map(answers.filter((answer) => answer.active).map((answer) => [answer.id, answer]));
  const future = /будет|продолжит|планирует|возьм[её]тся|перейд[её]т|следующ|ближайш|предстоит|нов(?:ый|ом) проект/iu;
  const skills = /использует|владе|знает|знани|навык|инструмент|программ|технолог|работает в|опыт с/iu;
  const supported = analysis.facts.filter((fact) => {
    if (fact.questionId !== 'q3' && fact.questionId !== 'q4') return true;
    if (fact.evidence.some((source) => answerById.get(source.answerId)?.questionId === fact.questionId)) return true;
    const quote = fact.evidence.map((source) => source.quote).join(' ');
    return fact.questionId === 'q3' ? future.test(quote) : skills.test(quote);
  });
  const prioritized = [...supported].sort((left, right) => {
    const direct = (fact: Fact) => Number(fact.evidence.some((source) => answerById.get(source.answerId)?.questionId === fact.questionId));
    return direct(right) - direct(left);
  });
  const seen = new Map<string, Fact>();
  const keptIds = new Set<string>();
  for (const fact of prioritized) {
    const key = normalizeForQuote(fact.text);
    const previous = seen.get(key);
    if (previous && previous.questionId !== fact.questionId) continue;
    seen.set(key, fact);
    keptIds.add(fact.id);
  }
  let facts = analysis.facts.filter((fact) => keptIds.has(fact.id));
  let ids = new Set(facts.map((fact) => fact.id));
  while (facts.some((fact) => fact.dependsOn.some((id) => !ids.has(id)))) {
    facts = facts.filter((fact) => fact.dependsOn.every((id) => ids.has(id)));
    ids = new Set(facts.map((fact) => fact.id));
  }
  const originalIds = new Set(analysis.facts.map((fact) => fact.id));
  return {
    ...analysis,
    facts,
    units: analysis.units.map((unit) => {
      const factIds = unit.factIds.filter((id) => ids.has(id) || !originalIds.has(id));
      return factIds.length === 0 && (unit.state === 'known' || unit.state === 'not_required')
        ? { ...unit, factIds, state: 'missing' as const }
        : { ...unit, factIds };
    }),
    conflicts: analysis.conflicts.flatMap((conflict) => {
      const factIds = conflict.factIds.filter((id) => ids.has(id) || !originalIds.has(id));
      return factIds.length > 0 ? [{ ...conflict, factIds }] : [];
    }),
  };
}

/** Проверяет вывод модели анализа. Возвращает анализ или список нарушений. */
export function checkAnalysisOutput(output: ModelOutput, answers: readonly AnswerRef[], recover = false): { analysis?: Analysis; issues: string[] } {
  if (output.raw === undefined) return { issues: ['Ответ не является корректным JSON'] };
  const parsed = AnalysisSchema.safeParse(output.raw);
  if (!parsed.success) return { issues: zodIssues(parsed.error) };
  const clean = pruneRepeatedFacts(parsed.data, answers);
  if (!recover) {
    const relations = validateAnalysisRelations(clean, answers);
    return relations.length > 0
      ? { issues: relations.map((issue) => `${issue.path}: ${issue.message}`) }
      : { analysis: clean, issues: [] };
  }
  const active = answers.filter((answer) => answer.active);
  const originalIds = new Set(clean.facts.map((fact) => fact.id));
  const byId = new Map(active.map((answer) => [answer.id, answer]));
  let facts = clean.facts.flatMap((fact) => {
    const evidence = fact.evidence.flatMap((source) => {
      if (!checkEvidence(source, byId)) return [source];
      const matching = active.filter((answer) =>
        answer.questionId === fact.questionId && quoteFoundIn(source.quote, answer.text));
      return matching.length === 1
        ? [{ ...source, answerId: matching[0]!.id, answerRevision: matching[0]!.revision }]
        : [];
    });
    return evidence.length > 0 ? [{ ...fact, evidence }] : [];
  });
  // Факты без подтверждённого источника и зависимые от них факты не учитываются.
  let ids = new Set(facts.map((fact) => fact.id));
  while (facts.some((fact) => fact.dependsOn.some((id) => !ids.has(id)))) {
    facts = facts.filter((fact) => fact.dependsOn.every((id) => ids.has(id)));
    ids = new Set(facts.map((fact) => fact.id));
  }
  const safeUnits = clean.units.map((unit) => {
    const factIds = unit.factIds.filter((id) => ids.has(id) || !originalIds.has(id));
    return factIds.length === 0 && (unit.state === 'known' || unit.state === 'not_required')
      ? { ...unit, factIds, state: 'missing' as const }
      : { ...unit, factIds };
  });
  // Одна и та же выдержка не может быть сразу первой и второй задачей.
  // Удаляем только повторную ссылку; новых сведений не добавляем.
  const task1 = new Set(safeUnits.find((unit) => unit.id === 'q1.task1')?.factIds ?? []);
  const normalized: Analysis = {
    ...clean,
    facts,
    conflicts: clean.conflicts.flatMap((conflict) => {
      const factIds = conflict.factIds.filter((id) => ids.has(id) || !originalIds.has(id));
      return factIds.length > 0 ? [{ ...conflict, factIds }] : [];
    }),
    units: safeUnits.map((unit) => {
      if (unit.id !== 'q1.task2') return unit;
      const factIds = unit.factIds.filter((id) => !task1.has(id));
      return factIds.length === 0 && unit.state === 'known'
        ? { ...unit, factIds, state: 'missing' as const }
        : { ...unit, factIds };
    }),
  };
  const relations = validateAnalysisRelations(normalized, answers);
  if (relations.length > 0) return { issues: relations.map((i) => `${i.path}: ${i.message}`) };
  return { analysis: normalized, issues: [] };
}

export interface AnalysisResult {
  analysis: Analysis;
  completeness: number;
  questionStatuses: Record<string, QuestionStatus>;
  meta: PipelineMeta;
}

export async function runAnalysis(params: {
  snapshot: Snapshot;
  previousFacts?: Fact[];
  analyzer: Analyzer;
  budget: Budget;
}): Promise<AnalysisResult> {
  const answers = activeAnswers(params.snapshot);
  const meta: PipelineMeta = { attempts: 0, repaired: false };
  const nonEmpty = answers.filter((a) => a.text.trim() !== '');

  let analysis: Analysis;
  if (nonEmpty.length === 0) {
    // Пустые ответы не отправляются провайдеру и не дают фактов.
    analysis = emptyAnalysis();
  } else {
    let repair: RepairRequest | undefined;
    let accepted: Analysis | undefined;
    for (let pass = 0; pass < 2 && !accepted; pass += 1) {
      const output = await callWithBudget(params.budget, (signal) =>
        params.analyzer.analyze({
          answers: nonEmpty,
          sessionRevision: params.snapshot.sessionRevision,
          previousFacts: params.previousFacts,
          repair,
          signal,
        }),
        { onAttempt: () => (meta.attempts += 1) },
      );
      const checked = checkAnalysisOutput(output, nonEmpty, pass === 1);
      if (checked.analysis) {
        const normalized = assignServerIds(checked.analysis);
        const issues = validateAnalysisRelations(normalized, nonEmpty);
        if (issues.length === 0) accepted = normalized;
        else checked.issues.push(...issues.map((i) => `${i.path}: ${i.message}`));
      }
      if (!accepted) {
        repair = { previousOutput: output.rawText.slice(0, 20000), issues: checked.issues };
        meta.repaired = pass === 0;
      }
    }
    if (!accepted) throw new AppError('INVALID_MODEL_OUTPUT', { detail: issuePaths(repair?.issues) });
    analysis = accepted;
  }

  const units = evaluateUnits(analysis, answers, params.snapshot.confirmedFactIds);
  return {
    analysis,
    completeness: completenessFromUnits(units),
    questionStatuses: questionStatuses(units),
    meta,
  };
}

export interface GenerationResult {
  document: VacancyDocument;
  usedFacts: Fact[];
  meta: PipelineMeta;
}

/** Проверка входа генерации без вызова модели. */
export function prepareGeneration(snapshot: Snapshot, analysis: Analysis, confirmedFactIds: readonly string[]) {
  const answers = activeAnswers(snapshot);
  const factIds = new Set(analysis.facts.map((f) => f.id));
  const unknownConfirmed = confirmedFactIds.filter((id) => !factIds.has(id));
  if (unknownConfirmed.length > 0) {
    throw new AppError('INVALID_REQUEST', { message: 'Подтверждены неизвестные факты', detail: unknownConfirmed.join(',') });
  }
  const confirmed = new Set(confirmedFactIds);
  const relationIssues = validateAnalysisRelations(analysis, answers);
  if (relationIssues.length > 0) {
    const staleConfirmed = analysis.facts.some(
      (f) => confirmed.has(f.id) && f.evidence.some((e) => answers.find((a) => a.id === e.answerId)?.revision !== e.answerRevision),
    );
    if (staleConfirmed) throw new AppError('STALE_REVISION');
    throw new AppError('INVALID_REQUEST', {
      message: 'Анализ не соответствует ответам',
      detail: relationIssues.slice(0, 3).map((i) => i.message).join(' | '),
    });
  }
  const tampered = findTamperedFactIds(analysis);
  if (tampered.length > 0) {
    throw new AppError('INVALID_REQUEST', { message: 'Факты изменены вне сервера', detail: `${tampered.length} фактов` });
  }
  const units = evaluateUnits(analysis, answers, confirmedFactIds);
  const facts = usableFacts(analysis, answers, confirmedFactIds);
  if (facts.length === 0) throw new AppError('INSUFFICIENT_FACTS');
  return { facts, gaps: computeGaps(units, facts), units };
}

export function checkDocumentOutput(output: ModelOutput, facts: readonly Fact[]): { document?: VacancyDocument; issues: string[] } {
  if (output.raw === undefined) return { issues: ['Ответ не является корректным JSON'] };
  const parsed = VacancyDocumentSchema.safeParse(output.raw);
  if (!parsed.success) return { issues: zodIssues(parsed.error) };
  const ordered = orderSections(parsed.data);
  const relations = validateDocumentRelations(ordered, facts);
  if (relations.length > 0) return { issues: relations.map((i) => `${i.path}: ${i.message}`) };
  return { document: ordered, issues: [] };
}

export async function runGeneration(params: {
  snapshot: Snapshot;
  analysis: Analysis;
  confirmedFactIds: string[];
  generator: Generator;
  budget: Budget;
}): Promise<GenerationResult> {
  const { facts, gaps } = prepareGeneration(params.snapshot, params.analysis, params.confirmedFactIds);
  const meta: PipelineMeta = { attempts: 0, repaired: false };
  let repair: RepairRequest | undefined;
  for (let pass = 0; pass < 2; pass += 1) {
    const output = await callWithBudget(
      params.budget,
      (signal) => params.generator.generate({ facts, gaps, sessionRevision: params.snapshot.sessionRevision, repair, signal }),
      { onAttempt: () => (meta.attempts += 1) },
    );
    const checked = checkDocumentOutput(output, facts);
    if (checked.document) {
      // Пробелы — серверные: модель не добавляет и не убирает их.
      return { document: { ...checked.document, gaps }, usedFacts: facts, meta };
    }
    repair = { previousOutput: output.rawText.slice(0, 20000), issues: checked.issues };
    meta.repaired = pass === 0;
  }
  throw new AppError('INVALID_MODEL_OUTPUT', { detail: issuePaths(repair?.issues) });
}
