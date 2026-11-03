import { describe, expect, it } from 'vitest';
import analysisFull from '../../fixtures/analysis.full.json';
import { AnalysisSchema } from '../../src/shared/schemas';
import { assignServerIds, findTamperedFactIds } from '../../src/server/factIds';

const full = AnalysisSchema.parse(analysisFull);

describe('серверные ID фактов', () => {
  it('переназначает ID вместе со ссылками', () => {
    const out = assignServerIds(full);
    expect(out.facts.every((f) => /^f_[0-9a-f]{16}$/.test(f.id))).toBe(true);
    const ids = new Set(out.facts.map((f) => f.id));
    for (const u of out.units) for (const id of u.factIds) expect(ids.has(id)).toBe(true);
    for (const f of out.facts) for (const d of f.dependsOn) expect(ids.has(d)).toBe(true);
    expect(findTamperedFactIds(out)).toEqual([]);
  });

  it('детерминированы: тот же вход — те же ID (подтверждение сохраняется)', () => {
    expect(assignServerIds(full).facts.map((f) => f.id)).toEqual(assignServerIds(structuredClone(full)).facts.map((f) => f.id));
  });

  it('новая ревизия источника меняет ID факта и зависимых', () => {
    const before = assignServerIds(full);
    const changed = structuredClone(full);
    changed.facts.find((f) => f.id === 'f3')!.evidence[0]!.answerRevision = 2;
    const after = assignServerIds(changed);
    const idx = (a: typeof before, i: number) => a.facts[i]!.id;
    expect(idx(after, 2)).not.toBe(idx(before, 2)); // проект q2
    expect(idx(after, 4)).not.toBe(idx(before, 4)); // q3 зависит от q2
    expect(idx(after, 0)).toBe(idx(before, 0)); // независимый факт q1
  });

  it('подмена текста факта клиентом обнаруживается', () => {
    const out = assignServerIds(full);
    out.facts[0]!.text = 'Зарплата 500000';
    expect(findTamperedFactIds(out)).toEqual([out.facts[0]!.id]);
  });
});
