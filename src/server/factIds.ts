/**
 * Серверные ID фактов. ID — хеш канонического содержания: вопрос, вид,
 * нормализованный текст, источники (answerId, revision, цитата) и ID зависимостей.
 * Подтверждение сохраняется только при точном совпадении этих данных
 * (docs/03-semantics.md, «Источники»). Правка ответа меняет revision → новый ID.
 */
import { createHash } from 'node:crypto';
import { normalizeForQuote } from '../shared/completeness';
import type { Analysis, Fact } from '../shared/schemas';

function canonicalText(text: string): string {
  return normalizeForQuote(text).replace(/[.!?;:,\s]+$/u, '');
}

export function canonicalFactId(fact: Pick<Fact, 'questionId' | 'kind' | 'text' | 'evidence'>, dependencyIds: readonly string[]): string {
  const evidence = fact.evidence
    .map((e) => [e.answerId, e.answerRevision, normalizeForQuote(e.quote)] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const payload = JSON.stringify([fact.questionId, fact.kind, canonicalText(fact.text), evidence, [...dependencyIds].sort()]);
  return `f_${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Переназначает ID фактов модели серверными. Предполагает, что анализ уже прошёл
 * validateAnalysisRelations (нет циклов и висячих ссылок). Дубли схлопываются.
 */
export function assignServerIds(analysis: Analysis): Analysis {
  const byModelId = new Map(analysis.facts.map((f) => [f.id, f]));
  const serverIds = new Map<string, string>();
  const compute = (modelId: string, stack: Set<string>): string => {
    const known = serverIds.get(modelId);
    if (known) return known;
    const fact = byModelId.get(modelId);
    if (!fact || stack.has(modelId)) throw new Error(`Некорректная зависимость ${modelId}`);
    stack.add(modelId);
    const deps = fact.dependsOn.map((d) => compute(d, stack));
    stack.delete(modelId);
    const id = canonicalFactId(fact, deps);
    serverIds.set(modelId, id);
    return id;
  };
  for (const fact of analysis.facts) compute(fact.id, new Set());

  const facts: Fact[] = [];
  const emitted = new Set<string>();
  for (const fact of analysis.facts) {
    const id = serverIds.get(fact.id)!;
    if (emitted.has(id)) continue;
    emitted.add(id);
    facts.push({ ...fact, id, dependsOn: uniq(fact.dependsOn.map((d) => serverIds.get(d)!)) });
  }
  return {
    facts,
    units: analysis.units.map((u) => ({ ...u, factIds: uniq(u.factIds.map((f) => serverIds.get(f)!)) })),
    conflicts: analysis.conflicts.map((c) => ({ ...c, factIds: uniq(c.factIds.map((f) => serverIds.get(f)!)) })),
  };
}

/** Проверяет, что ID фактов, пришедших от клиента, совпадают с каноническими. */
export function findTamperedFactIds(analysis: Analysis): string[] {
  const byId = new Map(analysis.facts.map((f) => [f.id, f]));
  const tampered: string[] = [];
  for (const fact of analysis.facts) {
    if (!fact.dependsOn.every((d) => byId.has(d))) {
      tampered.push(fact.id);
      continue;
    }
    if (canonicalFactId(fact, fact.dependsOn) !== fact.id) tampered.push(fact.id);
  }
  return tampered;
}
