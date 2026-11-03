/**
 * Детерминированные пресеты состояний для галереи (DES06). Без сетевых вызовов.
 * Данные — из fixtures/cases.json и fixtures/analysis.full.json.
 */
import analysisFull from '../../../fixtures/analysis.full.json';
import casesJson from '../../../fixtures/cases.json';
import vacancyFull from '../../../fixtures/vacancy.full.json';
import { LIMITS, QUESTION_IDS, SCHEMA_VERSION, UNIT_IDS, type QuestionId, type UnitId } from '../../shared/constants';
import { toEditable } from '../../shared/markdown';
import type { Analysis, ConfigResponse, VacancyDocument } from '../../shared/schemas';
import { failureToError, micError } from '../state/messages';
import { initialState } from '../state/transitions';
import type { ActionError, Answer, SessionState } from '../state/types';

const fullCase = casesJson.cases.find((c) => c.id === 'full')!;

export const demoConfig: ConfigResponse = {
  schemaVersion: SCHEMA_VERSION,
  mode: 'demo',
  limits: {
    maxRecordingSeconds: LIMITS.maxRecordingSeconds,
    maxAudioBytes: LIMITS.maxAudioBytes,
    maxAnswerChars: LIMITS.maxAnswerChars,
    maxActiveAnswers: LIMITS.maxActiveAnswers,
    maxSessionChars: LIMITS.maxSessionChars,
    maxClarificationsPerQuestion: LIMITS.maxClarificationsPerQuestion,
  },
  demo: {
    scenarios: [
      {
        id: 'guided',
        title: 'Сквозной сценарий с уточнением',
        description: 'Одна задача в первом ответе, уточнение, затем полные ответы.',
        answers: { q1: 'Проверяет счета поставщиков.', q2: fullCase.answers[1]!, q3: fullCase.answers[2]!, q4: fullCase.answers[3]! },
      },
    ],
    catalog: { q1: [fullCase.answers[0]!], q2: [fullCase.answers[1]!], q3: [fullCase.answers[2]!], q4: [fullCase.answers[3]!] },
  },
};

export const liveUnconfigured: ConfigResponse = {
  schemaVersion: SCHEMA_VERSION,
  mode: 'live',
  limits: demoConfig.limits,
  live: { sttConfigured: false, llmConfigured: false, sttModel: 'nova-3', sttLanguage: 'ru', llmModel: null },
};

const full = analysisFull as Analysis;

export function baseState(config: ConfigResponse = demoConfig): SessionState {
  const s = initialState({ status: 'ready', config });
  return { ...s, connection: { browserOnline: true, serviceUnreachable: false, recovered: false } };
}

function answer(q: QuestionId, i: number, text: string, extra: Partial<Answer> = {}): Answer {
  return {
    id: `a${i}`,
    questionId: q,
    revision: 1,
    text,
    active: true,
    kind: 'primary',
    unitId: null,
    inputMethod: 'voice',
    origin: 'fixture',
    ...extra,
  };
}

/** Полный пример: ответы a1–a4 и анализ; подтверждены факты указанных единиц. */
export function fullState(confirmedUnits: readonly UnitId[] = UNIT_IDS, opts: { questions?: QuestionId[] } = {}): SessionState {
  const questions = opts.questions ?? QUESTION_IDS;
  const answers = QUESTION_IDS.map((q, i) => answer(q, i + 1, fullCase.answers[i]!)).filter((a) => questions.includes(a.questionId));
  const confirmed = full.units.filter((u) => confirmedUnits.includes(u.id)).flatMap((u) => u.factIds);
  const answered = { q1: null, q2: null, q3: null, q4: null } as SessionState['answered'];
  for (const u of confirmedUnits) answered[u.split('.')[0] as QuestionId] = 'confirmed';
  return {
    ...baseState(),
    screen: 'question',
    stage: 'review',
    answers,
    sessionRevision: answers.length,
    analysis: full,
    analysisRevision: answers.length,
    analysisSource: 'fixture',
    confirmedFactIds: confirmed,
    answered,
  };
}

export function onQuestion(s: SessionState, q: QuestionId, patch: Partial<SessionState> = {}): SessionState {
  return { ...s, screen: 'question', questionIndex: QUESTION_IDS.indexOf(q), ...patch };
}

function vagueState(): SessionState {
  const a = answer('q1', 1, 'Занимается разными делами.');
  return {
    ...baseState(),
    screen: 'question',
    stage: 'review',
    answers: [a],
    sessionRevision: 1,
    analysis: { facts: [], units: UNIT_IDS.map((id) => ({ id, state: 'missing', factIds: [] })), conflicts: [] },
    analysisRevision: 1,
    analysisSource: 'fixture',
    clarification: { ...baseState().clarification, q1: { offered: 1, activeUnit: 'q1.task1', dismissed: false } },
  };
}

function conflictState(): SessionState {
  const text = 'Продолжит платёжный модуль. Одновременно утверждаю, что он его полностью оставит и перейдёт на CRM.';
  const a2 = answer('q2', 2, 'Работает над платёжным модулем.');
  const a3 = answer('q3', 3, text);
  const analysis: Analysis = {
    facts: [
      { id: 'p1', questionId: 'q2', kind: 'project', text: 'Платёжный модуль.', evidence: [{ answerId: 'a2', answerRevision: 1, quote: 'платёжным модулем' }], dependsOn: [] },
      { id: 'c1', questionId: 'q3', kind: 'direction', text: 'Продолжить работу над платёжным модулем.', evidence: [{ answerId: 'a3', answerRevision: 1, quote: 'Продолжит платёжный модуль' }], dependsOn: [] },
      { id: 'c2', questionId: 'q3', kind: 'direction', text: 'Полностью оставить платёжный модуль и перейти на CRM.', evidence: [{ answerId: 'a3', answerRevision: 1, quote: 'полностью оставит и перейдёт на CRM' }], dependsOn: [] },
    ],
    units: UNIT_IDS.map((id) =>
      id === 'q2.project'
        ? { id, state: 'known' as const, factIds: ['p1'] }
        : id === 'q3.direction' || id === 'q3.project'
          ? { id, state: 'conflict' as const, factIds: ['c1', 'c2'] }
          : { id, state: 'missing' as const, factIds: [] },
    ),
    conflicts: [{ factIds: ['c1', 'c2'], description: 'В ответе есть два плана: продолжить платёжный модуль и перейти на CRM.' }],
  };
  return onQuestion(
    {
      ...baseState(),
      stage: 'review',
      answers: [a2, a3],
      sessionRevision: 2,
      analysis,
      analysisRevision: 2,
      analysisSource: 'fixture',
      confirmedFactIds: ['p1'],
      answered: { q1: null, q2: 'confirmed', q3: null, q4: null },
    },
    'q3',
  );
}

function withDocument(s: SessionState, doc: VacancyDocument, patch: Partial<SessionState['document'] & object> = {}): SessionState {
  return {
    ...s,
    screen: 'result',
    document: {
      generatedAtRevision: s.sessionRevision,
      generatedAtFactsRevision: s.factsRevision,
      generated: doc,
      edited: toEditable(doc),
      isManuallyEdited: false,
      source: 'fixture',
      ...patch,
    },
  };
}

const fullDoc = vacancyFull as VacancyDocument;

function partialDoc(): VacancyDocument {
  return {
    ...fullDoc,
    sections: fullDoc.sections.map((sec) => (sec.id === 'next_six_months' || sec.id === 'knowledge' ? { ...sec, items: [] } : sec)),
    gaps: ['Не ясно, продолжит ли сотрудник текущий проект.', 'Не указан проект на следующие полгода.', 'Не указаны специальные знания.', 'Название должности не указано.', 'Условия работы не указаны.'],
  };
}

function err(op: 'transcribe' | 'analyze' | 'generate', code: string, q: QuestionId | null, retryAfterSeconds?: number): ActionError {
  return failureToError(
    op,
    { kind: 'http', status: 500, error: { code: code as never, message: '', retryable: true, retryAfterSeconds } },
    { questionId: q, requestId: 'req-gallery-0001', retry: op === 'generate' ? { op } : op === 'analyze' ? { op, questionId: q ?? 'q1' } : { op, answerId: 'a9' }, mode: 'demo' },
  )!;
}

function netErr(op: 'transcribe' | 'analyze' | 'generate', uploadComplete: boolean, q: QuestionId | null): ActionError {
  return failureToError(
    op,
    { kind: 'network', uploadComplete },
    { questionId: q, requestId: 'req-gallery-0002', retry: op === 'generate' ? { op } : op === 'analyze' ? { op, questionId: q ?? 'q1' } : { op, answerId: 'a9' }, mode: 'demo' },
  )!;
}

const fakeAudio = () => {
  const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
  return {
    answerId: 'a9',
    questionId: 'q1' as const,
    target: { kind: 'primary' as const },
    blob,
    url: '',
    mimeType: 'audio/webm;codecs=opus',
    sizeBytes: blob.size,
    durationMs: 14000,
    note: null,
  };
};

const request = (op: 'transcribe' | 'analyze' | 'generate', q: QuestionId | null) => ({
  requestId: `req-gallery-${op}`,
  op,
  startedAt: 0,
  sessionRevision: 4,
  factsRevision: 0,
  questionId: q,
  returnStage: 'review' as const,
});

export interface GalleryPreset {
  id: string;
  title: string;
  note?: string;
  build?: () => SessionState;
  /** Особая отрисовка (S25, N10). */
  special?: 'boundary' | 'n10';
}

const q1Ready = () => onQuestion(baseState(), 'q1', { stage: 'ready' });
const offline = (s: SessionState): SessionState => ({ ...s, connection: { browserOnline: false, serviceUnreachable: true, recovered: false } });

export const STATE_PRESETS: GalleryPreset[] = [
  { id: 'S01', title: 'Первая загрузка без ответов', build: () => baseState() },
  { id: 'S02', title: 'Вопрос открыт, ответа нет', build: q1Ready },
  {
    id: 'S03',
    title: 'Пустой текст отправлен на проверку',
    build: () => ({
      ...onQuestion(baseState(), 'q1', { stage: 'composing', composerText: '   ' }),
      error: { op: 'input', stateId: 'S03', code: 'EMPTY_ANSWER', title: 'Добавьте ответ или продолжите без него', message: 'Пустой ответ не отправляется на проверку.', saved: 'Другие ответы и прогресс не изменились.', retryable: false, questionId: 'q1', actions: ['continue_without', 'dismiss'] },
    }),
  },
  { id: 'S04', title: 'Речь не распознана', build: () => ({ ...q1Ready(), error: err('transcribe', 'NO_SPEECH', 'q1') }) },
  { id: 'S05', title: 'Текст есть, фактов нет', build: vagueState },
  { id: 'S06', title: 'Обзор без подтверждённых фактов', build: () => ({ ...baseState(), screen: 'overview' }) },
  {
    id: 'S07',
    title: 'Пустой раздел результата',
    build: () => withDocument(fullState(['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution', 'q4.tools']), partialDoc()),
  },
  { id: 'S08', title: 'В результате нет пробелов', note: 'Искусственный пресет: gaps пуст.', build: () => withDocument(fullState(), { ...fullDoc, gaps: [] }) },
  { id: 'S09', title: 'После явной очистки', note: 'Очистка возвращает начальный экран S01.', build: () => baseState() },
  { id: 'S10', title: 'Ожидание разрешения микрофона', build: () => onQuestion(baseState(), 'q1', { stage: 'requesting_permission' }) },
  { id: 'S11', title: 'Нет разрешения на микрофон', build: () => ({ ...q1Ready(), error: micError('permission_denied', 'q1') }) },
  { id: 'S12', title: 'Нет устройства или API', build: () => ({ ...q1Ready(), error: micError('no_device', 'q1') }) },
  { id: 'S13', title: 'Микрофон отключён во время записи', build: () => onQuestion(baseState(), 'q1', { stage: 'recorded', pendingAudio: { ...fakeAudio(), note: 'interrupted' } }) },
  { id: 'S14', title: 'Обработка (анализ)', build: () => ({ ...onQuestion(fullState(['q1.task1']), 'q1'), stage: 'analyzing', request: request('analyze', 'q1') }) },
  { id: 'S15', title: 'Обработка дольше 10 секунд', build: () => ({ ...onQuestion(fullState(['q1.task1']), 'q1'), stage: 'analyzing', request: request('analyze', 'q1'), slow: true }) },
  {
    id: 'S16',
    title: 'Превышен лимит текста',
    build: () => ({
      ...onQuestion(baseState(), 'q1', { stage: 'composing', composerText: 'Проверяет счета. '.repeat(250) }),
      error: { op: 'input', stateId: 'S16', code: 'TOO_LONG', title: 'Сократите ответ до 4000 символов', message: 'Сейчас 4250 символов. Текст не обрезается автоматически.', saved: 'Введённый текст сохранён в поле.', retryable: false, questionId: 'q1', actions: ['dismiss'] },
    }),
  },
  { id: 'S17', title: '429: слишком много запросов', build: () => ({ ...onQuestion(fullState([]), 'q1'), error: err('analyze', 'RATE_LIMITED', 'q1', 30) }) },
  { id: 'S18', title: '5xx / ошибка провайдера', build: () => ({ ...onQuestion(fullState([]), 'q1'), error: err('analyze', 'PROVIDER_ERROR', 'q1') }) },
  { id: 'S19', title: 'Тайм-аут', build: () => ({ ...onQuestion(fullState([]), 'q1'), error: err('analyze', 'PROVIDER_TIMEOUT', 'q1') }) },
  { id: 'S20', title: 'Невалидный ответ AI', build: () => ({ ...onQuestion(fullState([]), 'q1'), error: err('analyze', 'INVALID_MODEL_OUTPUT', 'q1') }) },
  { id: 'S21', title: 'Противоречие в ответах', build: conflictState },
  {
    id: 'S22',
    title: 'Результат устарел после правки',
    build: () => {
      const s = withDocument(fullState(), fullDoc);
      return { ...s, sessionRevision: s.sessionRevision + 1, answers: s.answers.map((a) => (a.id === 'a1' ? { ...a, revision: 2, text: a.text + ' Также сверяет акты.' } : a)) };
    },
  },
  {
    id: 'S23',
    title: 'Ошибка копирования',
    build: () => ({
      ...withDocument(fullState(), fullDoc),
      error: { op: 'copy', stateId: 'S23', code: 'CLIPBOARD', title: 'Не удалось скопировать текст', message: 'Браузер не дал доступ к буферу обмена.', saved: 'Текст описания не изменился.', retryable: false, questionId: null, actions: ['select_text', 'download'] },
    }),
  },
  { id: 'S24', title: 'Live не настроен', build: () => baseState(liveUnconfigured) },
  { id: 'S25', title: 'Ошибка отрисовки раздела', special: 'boundary' },
  { id: 'S26', title: 'Не загружена конфигурация', build: () => ({ ...initialState({ status: 'error', message: 'Не удалось подключиться к сервису' }) }) },
];

export const NETWORK_PRESETS: GalleryPreset[] = [
  { id: 'N01', title: 'Нет сети после загрузки', build: () => offline(onQuestion(fullState(['q1.task1', 'q1.task2']), 'q1')) },
  {
    id: 'N02',
    title: 'Сеть пропала во время записи',
    build: () => offline(onQuestion(fullState(['q1.task1', 'q1.task2']), 'q2', { stage: 'recording', recording: { startedAt: Date.now() - 12000, mimeType: 'audio/webm', meter: null } })),
  },
  { id: 'N03', title: 'Не удалось отправить аудио', build: () => offline({ ...onQuestion(baseState(), 'q1', { stage: 'recorded', pendingAudio: fakeAudio() }), error: netErr('transcribe', false, 'q1') }) },
  { id: 'N04', title: 'Ответ анализа не получен', build: () => ({ ...offline(onQuestion(fullState([]), 'q1')), error: netErr('analyze', true, 'q1') }) },
  { id: 'N05', title: 'Сеть пропала при генерации', build: () => ({ ...offline({ ...fullState(), screen: 'overview' }), error: netErr('generate', true, null) }) },
  { id: 'N06', title: 'Нет сети на результате', build: () => offline(withDocument(fullState(), fullDoc)) },
  {
    id: 'N07',
    title: 'Браузер сообщил о восстановлении',
    build: () => ({ ...onQuestion(fullState([]), 'q1'), connection: { browserOnline: true, serviceUnreachable: false, recovered: true }, error: netErr('analyze', true, 'q1') }),
  },
  { id: 'N08', title: 'Повтор успешен', note: 'Ошибка снята, применён ответ актуального requestId.', build: () => onQuestion(fullState(['q1.task1', 'q1.task2']), 'q1') },
  { id: 'N09', title: 'Медленное соединение', note: 'Ожидание, затем S15 и при необходимости S19.', build: () => ({ ...onQuestion(fullState([]), 'q1'), stage: 'analyzing', request: request('analyze', 'q1'), slow: true }) },
  { id: 'N10', title: 'Приложение не загрузилось без сети', special: 'n10' },
];

export const ALL_PRESETS = [...STATE_PRESETS, ...NETWORK_PRESETS];
