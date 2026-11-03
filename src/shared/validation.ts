/**
 * Проверка отношений внутри анализа и документа. JSON Schema этого не проверяет
 * (docs/05-contracts.md, «Дополнительные инварианты»).
 */
import {
  NOT_REQUIRED_ALLOWED,
  SECTION_IDS,
  UNIT_IDS,
  UNIT_QUESTION,
  DEFAULT_TITLE,
} from './constants';
import { checkEvidence, indexAnswers, normalizeForQuote, type AnswerRef } from './completeness';
import type { Analysis, Fact, VacancyDocument } from './schemas';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Ищет цикл в графе dependsOn. Возвращает id факта в цикле или null. */
export function findDependencyCycle(facts: readonly Pick<Fact, 'id' | 'dependsOn'>[]): string | null {
  const graph = new Map(facts.map((f) => [f.id, f.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): string | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') return id;
    state.set(id, 'visiting');
    for (const dep of graph.get(id) ?? []) {
      if (!graph.has(dep)) continue;
      const found = visit(dep);
      if (found) return found;
    }
    state.set(id, 'done');
    return null;
  };
  for (const f of facts) {
    const found = visit(f.id);
    if (found) return found;
  }
  return null;
}

/**
 * Полная проверка связей анализа относительно активных ответов снимка.
 * Пустой массив — анализ допустим.
 */
export function validateAnalysisRelations(analysis: Analysis, answers: readonly AnswerRef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const active = answers.filter((a) => a.active);
  const answersById = indexAnswers(active);

  // Ровно восемь единиц с уникальными ID.
  const unitIds = analysis.units.map((u) => u.id);
  for (const id of UNIT_IDS) {
    const count = unitIds.filter((u) => u === id).length;
    if (count !== 1) issues.push({ path: `units.${id}`, message: `Единица ${id} встречается ${count} раз` });
  }

  // Уникальные ID фактов.
  const factIds = new Set<string>();
  analysis.facts.forEach((fact, i) => {
    if (factIds.has(fact.id)) issues.push({ path: `facts[${i}].id`, message: `Повтор id факта ${fact.id}` });
    factIds.add(fact.id);
  });
  const factsById = new Map(analysis.facts.map((f) => [f.id, f]));

  // Источники.
  analysis.facts.forEach((fact, i) => {
    fact.evidence.forEach((ev, j) => {
      const issue = checkEvidence(ev, answersById);
      if (issue) {
        issues.push({ path: `facts[${i}].evidence[${j}]`, message: `Источник недействителен: ${issue}` });
      }
    });
    fact.dependsOn.forEach((dep, j) => {
      if (dep === fact.id) issues.push({ path: `facts[${i}].dependsOn[${j}]`, message: 'Факт зависит от себя' });
      else if (!factsById.has(dep)) issues.push({ path: `facts[${i}].dependsOn[${j}]`, message: `Нет факта ${dep}` });
    });
  });

  const cycle = findDependencyCycle(analysis.facts);
  if (cycle) issues.push({ path: 'facts.dependsOn', message: `Цикл зависимостей через ${cycle}` });

  // Единицы.
  analysis.units.forEach((unit, i) => {
    if ((unit.state === 'known' || unit.state === 'not_required') && unit.factIds.length === 0) {
      issues.push({ path: `units[${i}]`, message: `${unit.id}: состояние ${unit.state} требует factIds` });
    }
    if (unit.state === 'not_required' && !NOT_REQUIRED_ALLOWED.includes(unit.id)) {
      issues.push({ path: `units[${i}]`, message: `${unit.id}: not_required допустим только для q4` });
    }
    const seen = new Set<string>();
    unit.factIds.forEach((fid, j) => {
      if (seen.has(fid)) issues.push({ path: `units[${i}].factIds[${j}]`, message: `Повтор ${fid}` });
      seen.add(fid);
      const fact = factsById.get(fid);
      if (!fact) {
        issues.push({ path: `units[${i}].factIds[${j}]`, message: `Нет факта ${fid}` });
      } else if (fact.questionId !== UNIT_QUESTION[unit.id]) {
        issues.push({
          path: `units[${i}].factIds[${j}]`,
          message: `Факт ${fid} относится к ${fact.questionId}, а единица — к ${UNIT_QUESTION[unit.id]}`,
        });
      }
    });
  });

  // q1.task2 — вторая отличающаяся задача: один факт не закрывает обе единицы.
  const task1 = analysis.units.find((u) => u.id === 'q1.task1')?.factIds ?? [];
  const task2 = analysis.units.find((u) => u.id === 'q1.task2')?.factIds ?? [];
  if (task1.some((id) => task2.includes(id))) {
    issues.push({ path: 'units.q1.task2', message: 'Вторая задача должна отличаться от первой' });
  }

  analysis.conflicts.forEach((conflict, i) => {
    conflict.factIds.forEach((fid, j) => {
      if (!factsById.has(fid)) issues.push({ path: `conflicts[${i}].factIds[${j}]`, message: `Нет факта ${fid}` });
    });
  });

  return issues;
}

/** Нормализация для эвристики «не выдумано»: регистр, пробелы, ё. */
function normalizeLoose(value: string): string {
  return normalizeForQuote(value).replace(/ё/gu, 'е');
}

/**
 * Признаки условий, которые генерация не должна добавлять без источника
 * (docs/06-generation.md). Эвристика: ловит явные случаи, не любую галлюцинацию.
 */
export const INVENTED_CONDITION_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'зарплата', pattern: /зарплат|заработн|оклад|доход|(?<!\p{L})руб(\.|л)|₽|\$|€|вознагражден/u },
  { label: 'стаж', pattern: /стаж|опыт\S*\s+(работы\s+)?от|лет опыта|года? опыта/u },
  { label: 'уровень', pattern: /senior|middle|junior|lead\b|сеньор|синьор|мидл|джун|ведущ|старш|младш/u },
  { label: 'формат работы', pattern: /удален|удалён|офис|гибрид|релокац|командиров|график работы|полный день|частичн/u },
  { label: 'льготы', pattern: /дмс|льгот|бонус|преми|компенсац|страховк/u },
  { label: 'образование', pattern: /образовани|диплом|высшее/u },
  { label: 'компания', pattern: /(?<!\p{L})компани|(?<!\p{L})ооо(?!\p{L})|(?<!\p{L})ао(?!\p{L})|корпорац/u },
];

export interface InventionIssue {
  label: string;
  text: string;
}

/**
 * Ищет в документе числа и признаки условий, которых нет в тексте и цитатах
 * подтверждённых фактов.
 */
export function findInventedContent(document: VacancyDocument, facts: readonly Fact[]): InventionIssue[] {
  const source = normalizeLoose(
    facts.map((f) => [f.text, ...f.evidence.map((e) => e.quote)].join(' ')).join(' \n '),
  );
  const issues: InventionIssue[] = [];
  const texts = [document.title.text, ...document.sections.flatMap((s) => s.items.map((i) => i.text))];
  for (const raw of texts) {
    const text = normalizeLoose(raw);
    for (const num of text.match(/\d+/gu) ?? []) {
      if (!source.includes(num)) issues.push({ label: `число ${num}`, text: raw });
    }
    for (const { label, pattern } of INVENTED_CONDITION_PATTERNS) {
      const m = text.match(pattern);
      if (m && !pattern.test(source)) issues.push({ label, text: raw });
    }
  }
  return issues;
}

/**
 * Проверка документа: разделы ровно один раз и в порядке, ссылки только на
 * переданные подтверждённые факты, заголовок по правилам.
 */
export function validateDocumentRelations(document: VacancyDocument, allowedFacts: readonly Fact[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = new Map(allowedFacts.map((f) => [f.id, f]));
  const ids = document.sections.map((s) => s.id);
  SECTION_IDS.forEach((id, i) => {
    if (ids.filter((x) => x === id).length !== 1) issues.push({ path: `sections.${id}`, message: 'Раздел должен быть ровно один раз' });
    else if (ids[i] !== id) issues.push({ path: `sections[${i}]`, message: `Ожидался раздел ${id}` });
  });
  document.sections.forEach((section, i) => {
    section.items.forEach((item, j) => {
      item.sourceFactIds.forEach((fid) => {
        if (!allowed.has(fid)) issues.push({ path: `sections[${i}].items[${j}]`, message: `Ссылка на неподтверждённый или неизвестный факт ${fid}` });
      });
    });
  });
  document.title.sourceFactIds.forEach((fid) => {
    const fact = allowed.get(fid);
    if (!fact) issues.push({ path: 'title', message: `Ссылка на неизвестный факт ${fid}` });
    else if (fact.kind !== 'role_title') issues.push({ path: 'title', message: 'Заголовок ссылается не на название должности' });
  });
  if (document.title.sourceFactIds.length === 0 && document.title.text.trim() !== DEFAULT_TITLE) {
    issues.push({ path: 'title', message: 'Заголовок без источника должен быть нейтральным' });
  }
  for (const inv of findInventedContent(document, allowedFacts)) {
    issues.push({ path: 'content', message: `Похоже на добавленные сведения (${inv.label}): «${inv.text}»` });
  }
  return issues;
}

/** Если модель вернула все разделы, но в другом порядке — упорядочить. */
export function orderSections(document: VacancyDocument): VacancyDocument {
  const byId = new Map(document.sections.map((s) => [s.id, s]));
  if (byId.size !== SECTION_IDS.length) return document;
  return { ...document, sections: SECTION_IDS.map((id) => byId.get(id)!) };
}
