/**
 * Пробелы описания вычисляет сервер детерминированно: незаполненные единицы,
 * должность и условия. Модель не добавляет пробелы от себя.
 */
import { CONDITIONS_GAP, ROLE_TITLE_GAP, UNIT_GAPS } from './constants';
import type { UnitEvaluation } from './completeness';
import type { Fact } from './schemas';

export function computeGaps(units: readonly UnitEvaluation[], facts: readonly Fact[]): string[] {
  const gaps: string[] = [];
  const q1Missing = units.filter((u) => u.questionId === 'q1' && !u.valid);
  // Если нет ни одной задачи, достаточно одного пункта про задачи.
  if (q1Missing.length === 2) gaps.push('Не указаны ежедневные задачи.');
  else for (const u of q1Missing) gaps.push(UNIT_GAPS[u.id]);
  for (const u of units) {
    if (u.questionId !== 'q1' && !u.valid) gaps.push(UNIT_GAPS[u.id]);
  }
  if (!facts.some((f) => f.kind === 'role_title')) gaps.push(ROLE_TITLE_GAP);
  // Условия (зарплата, формат, график) не входят в четыре вопроса и не уменьшают полноту.
  gaps.push(CONDITIONS_GAP);
  return gaps;
}
