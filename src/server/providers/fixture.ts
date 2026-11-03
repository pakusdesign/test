/**
 * Demo-провайдеры. Не вызывают внешние сервисы и не имитируют AI на произвольных данных.
 * - FixtureTranscriber возвращает ответ выбранного сценария; аудио не принимает.
 * - FixtureAnalyzer собирает анализ из каталога для известных текстов.
 * - TemplateGenerator строит описание шаблоном: один пункт = текст подтверждённого факта.
 */
import { DEFAULT_TITLE, QUESTIONS, type QuestionId, type UnitId, type UnitState } from '../../shared/constants';
import type { Analysis, Fact, Unit, VacancyDocument } from '../../shared/schemas';
import { AppError } from '../errors';
import { DEMO_SCENARIOS, clarificationText, findDemoEntry, type DemoFactSpec } from '../demo/catalog';
import type { Analyzer, AnalyzerInput, Generator, GeneratorInput, ModelOutput, Transcriber, TranscribeInput } from './types';

export class FixtureTranscriber implements Transcriber {
  readonly source = 'fixture' as const;
  readonly model = null;

  async transcribe(input: TranscribeInput) {
    if (input.audio) {
      // В demo аудио не отправляется и не обрабатывается (docs/04-architecture.md).
      throw new AppError('INVALID_REQUEST', { message: 'В демонстрации запись не отправляется на сервер' });
    }
    if (!input.questionId) throw new AppError('INVALID_REQUEST', { message: 'Не указан вопрос сценария' });
    let text: string | undefined;
    if (input.unitId) {
      text = clarificationText(input.unitId);
    } else {
      const scenario = DEMO_SCENARIOS.find((s) => s.id === input.scenarioId);
      if (!scenario) throw new AppError('INVALID_REQUEST', { message: 'Выберите тестовый сценарий' });
      text = scenario.answers[input.questionId];
    }
    if (!text || text.trim() === '') {
      throw new AppError('NO_SPEECH', { message: 'Не удалось распознать речь. В тестовом сценарии нет ответа на этот вопрос' });
    }
    return { text, language: 'ru' };
  }
}

interface BuiltFact extends Fact {
  spec: DemoFactSpec;
}

export class FixtureAnalyzer implements Analyzer {
  readonly source = 'fixture' as const;
  readonly model = null;
  readonly promptVersion = 'fixture-1.0';

  async analyze(input: AnalyzerInput): Promise<ModelOutput> {
    const facts: BuiltFact[] = [];
    const unknown = new Set<UnitId>();
    const conflicts: { factIds: string[]; units: UnitId[]; description: string }[] = [];
    let counter = 0;

    for (const answer of input.answers) {
      if (!answer.active || answer.text.trim() === '') continue;
      const entry = findDemoEntry(answer.questionId, answer.text);
      if (!entry) {
        throw new AppError('DEMO_UNSUPPORTED_TEXT', {
          message: `В демонстрации анализируется только текст тестовых сценариев (вопрос ${QUESTIONS[answer.questionId].index + 1}). Выберите текст сценария или включите live`,
        });
      }
      const ids: string[] = [];
      for (const spec of entry.facts) {
        // Повтор того же сведения в другом ответе — один факт с двумя источниками,
        // а не вторая «отличающаяся» задача (03-semantics).
        const same = facts.find((f) => f.questionId === spec.questionId && f.kind === spec.kind && f.text === spec.text);
        if (same && !entry.conflict) {
          same.evidence.push({ answerId: answer.id, answerRevision: answer.revision, quote: spec.quote });
          ids.push(same.id);
          continue;
        }
        counter += 1;
        const id = `d${counter}`;
        ids.push(id);
        facts.push({
          id,
          questionId: spec.questionId,
          kind: spec.kind,
          text: spec.text,
          evidence: [{ answerId: answer.id, answerRevision: answer.revision, quote: spec.quote }],
          dependsOn: [],
          spec,
        });
      }
      entry.unknownUnits?.forEach((u) => unknown.add(u));
      if (entry.conflict) conflicts.push({ factIds: ids, ...entry.conflict });
    }

    // Связь «тот же проект» с текущим проектом q2.
    const currentProject = facts.find((f) => f.questionId === 'q2' && f.kind === 'project');
    const resolved = facts.filter((f) => {
      if (f.spec.requiresCurrentProject && !currentProject) return false;
      if (f.spec.dependsOnCurrentProject && currentProject) f.dependsOn = [currentProject.id];
      return true;
    });

    const conflictFacts = new Set(conflicts.flatMap((c) => c.factIds));
    const conflictUnits = new Map<UnitId, string[]>();
    for (const c of conflicts) for (const u of c.units) conflictUnits.set(u, [...(conflictUnits.get(u) ?? []), ...c.factIds]);

    const pick = (q: QuestionId, kinds: Fact['kind'][]) =>
      resolved.filter((f) => f.questionId === q && kinds.includes(f.kind) && !conflictFacts.has(f.id));

    const tasks = pick('q1', ['task']);
    const q3Projects = pick('q3', ['project']);
    const tools = pick('q4', ['tool']);
    const knowledge = pick('q4', ['knowledge']);

    const unitFacts: Record<UnitId, BuiltFact[]> = {
      'q1.task1': tasks.slice(0, 1),
      'q1.task2': tasks.slice(1, 2),
      'q2.project': pick('q2', ['project']).slice(0, 1),
      'q2.contribution': pick('q2', ['contribution']),
      'q3.direction': pick('q3', ['direction']),
      'q3.project': q3Projects,
      'q4.tools': tools,
      'q4.knowledge': knowledge,
    };

    const units: Unit[] = (Object.keys(unitFacts) as UnitId[]).map((id) => {
      const conflictIds = conflictUnits.get(id);
      if (conflictIds) return { id, state: 'conflict', factIds: conflictIds };
      const list = unitFacts[id];
      if (list.length > 0) {
        const state: UnitState = list.every((f) => f.spec.notRequired) ? 'not_required' : 'known';
        return { id, state, factIds: list.map((f) => f.id) };
      }
      return { id, state: unknown.has(id) ? 'unknown' : 'missing', factIds: [] };
    });

    const analysis: Analysis = {
      facts: resolved.map(({ spec: _spec, ...fact }) => fact),
      units,
      conflicts: conflicts.map((c) => ({ factIds: c.factIds, description: c.description })),
    };
    return { raw: analysis, rawText: JSON.stringify(analysis) };
  }
}

export class TemplateGenerator implements Generator {
  readonly source = 'fixture' as const;
  readonly model = null;
  readonly promptVersion = 'template-1.0';

  async generate(input: GeneratorInput): Promise<ModelOutput> {
    const item = (f: Fact) => ({ text: f.text, sourceFactIds: [f.id] });
    const of = (q: QuestionId, kinds: Fact['kind'][]) => input.facts.filter((f) => f.questionId === q && kinds.includes(f.kind));
    const q3Projects = of('q3', ['project']);
    const role = input.facts.find((f) => f.kind === 'role_title');
    const document: VacancyDocument = {
      title: role ? { text: role.text, sourceFactIds: [role.id] } : { text: DEFAULT_TITLE, sourceFactIds: [] },
      sections: [
        { id: 'daily_tasks', items: of('q1', ['task', 'other']).map(item) },
        { id: 'current_project', items: of('q2', ['project', 'contribution', 'other']).map(item) },
        {
          id: 'next_six_months',
          items: (q3Projects.length > 0 ? q3Projects : of('q3', ['direction'])).concat(of('q3', ['other'])).map(item),
        },
        { id: 'tools', items: of('q4', ['tool', 'other']).map(item) },
        { id: 'knowledge', items: of('q4', ['knowledge']).map(item) },
      ],
      gaps: input.gaps,
    };
    return { raw: document, rawText: JSON.stringify(document) };
  }
}
