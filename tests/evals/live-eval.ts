/**
 * Live-проверка (платные вызовы): npm run eval:live
 * - Анализ: каждый текстовый случай fixtures/cases.json прогоняется 3 раза через Anthropic.
 *   Проверяются инварианты и ожидаемые состояния единиц, не литературный текст.
 * - Генерация: случай full — пять разделов, «Python желателен», нет выдуманных условий.
 * - STT: синтетические голосовые примеры tests/evals/audio через Deepgram.
 * Без ключей — статус BLOCKED и код выхода 2. Секреты не выводятся и не сохраняются.
 * Отчёт: docs/evidence/live-eval.json (без текстов ответов модели).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import casesJson from '../../fixtures/cases.json' with { type: 'json' };
import { evaluateUnits, completenessFromUnits } from '../../src/shared/completeness';
import { EXTRACT_PROMPT_VERSION, GENERATE_PROMPT_VERSION } from '../../src/shared/constants';
import { createBudget } from '../../src/server/budget';
import { loadDotEnv, loadServerConfig } from '../../src/server/config';
import { AppError } from '../../src/server/errors';
import { runAnalysis, runGeneration } from '../../src/server/pipeline';
import { createProviders } from '../../src/server/providers';

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const OUT = path.resolve('docs/evidence/live-eval.json');
const QIDS = ['q1', 'q2', 'q3', 'q4'] as const;

type CaseJson = (typeof casesJson.cases)[number] & {
  expectedKnownUnits?: string[];
  expectedNotRequiredUnits?: string[];
  expectedConflictUnits?: string[];
  expectedMissingUnits?: string[];
  expectedPercentAfterConfirmation?: number;
  mustPreserve?: string[];
  mustNotInvent?: string[];
};

function write(report: unknown) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
}

async function main() {
  loadDotEnv(process.cwd());
  const config = { ...loadServerConfig({ ...process.env, APP_MODE: 'live' }), providerTimeoutMs: 45000 };
  const missing = [
    !config.anthropicApiKey && 'ANTHROPIC_API_KEY',
    !config.llmModel && 'LLM_MODEL',
    !config.deepgramApiKey && 'DEEPGRAM_API_KEY',
  ].filter(Boolean) as string[];
  const started = new Date().toISOString();
  if (!config.anthropicApiKey || !config.llmModel) {
    const report = { status: 'BLOCKED', date: started, reason: `Не заданы переменные: ${missing.join(', ')}`, runs: [] };
    write(report);
    console.log(`BLOCKED: live-проверка не выполнена. Не заданы: ${missing.join(', ')}. Заполните .env (см. .env.example).`);
    process.exitCode = 2;
    return;
  }

  const providers = createProviders(config);
  const results: Record<string, unknown>[] = [];
  let failures = 0;

  for (const c of casesJson.cases as CaseJson[]) {
    const answers = c.answers
      .map((text, i) => ({ id: `a${i + 1}`, questionId: QIDS[i]!, revision: 1, text, active: true }))
      .filter((a) => a.text !== '');
    for (let run = 1; run <= RUNS; run += 1) {
      const t0 = Date.now();
      const checks: string[] = [];
      try {
        const res = await runAnalysis({
          snapshot: { sessionRevision: 1, answers, confirmedFactIds: [] },
          analyzer: providers.analyzer,
          budget: createBudget(config.providerTimeoutMs, new AbortController().signal),
        });
        const all = res.analysis.facts.map((f) => f.id);
        const units = evaluateUnits(res.analysis, answers, all);
        const states = Object.fromEntries(res.analysis.units.map((u) => [u.id, u.state]));
        const expectState = (ids: string[] | undefined, state: string) => {
          for (const id of ids ?? []) if (states[id] !== state) checks.push(`${id}: ожидалось ${state}, получено ${states[id]}`);
        };
        expectState(c.expectedKnownUnits, 'known');
        expectState(c.expectedNotRequiredUnits, 'not_required');
        expectState(c.expectedConflictUnits, 'conflict');
        expectState(c.expectedMissingUnits, 'missing');
        const pct = completenessFromUnits(units);
        if (c.expectedPercentAfterConfirmation !== undefined && pct !== c.expectedPercentAfterConfirmation) {
          checks.push(`полнота ${pct}, ожидалось ${c.expectedPercentAfterConfirmation}`);
        }
        const factText = res.analysis.facts.map((f) => f.text).join(' ').toLowerCase();
        for (const w of c.mustNotInvent ?? []) if (factText.includes(w.toLowerCase())) checks.push(`в фактах есть «${w}»`);
        let generation: Record<string, unknown> | undefined;
        if (c.id === 'full' || c.id === 'negation') {
          const gen = await runGeneration({
            snapshot: { sessionRevision: 1, answers, confirmedFactIds: all },
            analysis: res.analysis,
            confirmedFactIds: all,
            generator: providers.generator,
            budget: createBudget(config.providerTimeoutMs, new AbortController().signal),
          });
          const docText = JSON.stringify(gen.document);
          for (const w of c.mustPreserve ?? []) if (!docText.includes(w)) checks.push(`в описании нет «${w}»`);
          for (const w of c.mustNotInvent ?? []) if (docText.toLowerCase().includes(w.toLowerCase())) checks.push(`в описании есть «${w}»`);
          generation = { sections: gen.document.sections.map((s) => [s.id, s.items.length]), attempts: gen.meta.attempts };
        }
        results.push({ case: c.id, run, ok: checks.length === 0, checks, completeness: pct, attempts: res.meta.attempts, repaired: res.meta.repaired, durationMs: Date.now() - t0, generation });
      } catch (error) {
        const code = error instanceof AppError ? error.code : error instanceof Error ? error.name : 'unknown';
        checks.push(`ошибка: ${code}`);
        results.push({ case: c.id, run, ok: false, checks, durationMs: Date.now() - t0 });
      }
      if (checks.length > 0) failures += 1;
      console.log(`${checks.length === 0 ? 'OK  ' : 'FAIL'} ${c.id} #${run} ${checks.join('; ')}`);
    }
  }

  // STT на синтетических примерах.
  const stt: Record<string, unknown>[] = [];
  const audioDir = path.resolve('tests/evals/audio');
  const sttCases = [
    { file: 'quiet-q1.webm', expect: ['отказ', 'конверси'] },
    { file: 'quiet-q2.webm', expect: ['платёжн', 'модул'] },
    { file: 'noise-q1.webm', expect: ['отказ'] },
    { file: 'names-q4.webm', expect: ['sql', 'metabase'] },
    { file: 'silence.webm', expect: [], silence: true },
  ];
  if (config.deepgramApiKey && existsSync(audioDir)) {
    for (const sc of sttCases) {
      const t0 = Date.now();
      try {
        const res = await providers.transcriber.transcribe({
          audio: readFileSync(path.join(audioDir, sc.file)),
          mimeType: 'audio/webm',
          signal: AbortSignal.timeout(45000),
        });
        const lower = res.text.toLowerCase().replace(/ё/g, 'е');
        const found = sc.expect.filter((w) => lower.includes(w.replace(/ё/g, 'е')));
        stt.push({ file: sc.file, ok: !sc.silence && found.length === sc.expect.length, found, expected: sc.expect, chars: res.text.length, durationMs: Date.now() - t0 });
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'error';
        stt.push({ file: sc.file, ok: Boolean(sc.silence && code === 'NO_SPEECH'), code, durationMs: Date.now() - t0 });
      }
    }
  }

  const report = {
    status: failures === 0 ? 'PASS' : 'FAIL',
    date: started,
    llmModel: config.llmModel,
    sttModel: config.sttModel,
    promptVersions: { extract: EXTRACT_PROMPT_VERSION, generate: GENERATE_PROMPT_VERSION },
    runsPerCase: RUNS,
    note: 'Три прогона — ограниченная проверка, не статистическое доказательство качества.',
    failures,
    results,
    stt: config.deepgramApiKey ? stt : 'BLOCKED: DEEPGRAM_API_KEY не задан',
  };
  write(report);
  console.log(`Итог: ${report.status}, ошибок ${failures} из ${results.length}. Отчёт: ${OUT}`);
  if (failures > 0) process.exitCode = 1;
}

void main();
