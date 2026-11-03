/**
 * Общие константы продукта. Источники: docs/01-prd.md (вопросы),
 * docs/03-semantics.md (единицы и уточнения), docs/04-architecture.md (лимиты).
 */

export const SCHEMA_VERSION = '1.0' as const;
export const EXTRACT_PROMPT_VERSION = 'extract-1.0';
export const GENERATE_PROMPT_VERSION = 'generate-1.0';

export const QUESTION_IDS = ['q1', 'q2', 'q3', 'q4'] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

export const UNIT_IDS = [
  'q1.task1',
  'q1.task2',
  'q2.project',
  'q2.contribution',
  'q3.direction',
  'q3.project',
  'q4.tools',
  'q4.knowledge',
] as const;
export type UnitId = (typeof UNIT_IDS)[number];

export const FACT_KINDS = [
  'task',
  'project',
  'contribution',
  'direction',
  'tool',
  'knowledge',
  'role_title',
  'other',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const UNIT_STATES = ['known', 'missing', 'unknown', 'not_required', 'conflict'] as const;
export type UnitState = (typeof UNIT_STATES)[number];

/** Единицы, для которых допустим not_required (semantics: только q4). */
export const NOT_REQUIRED_ALLOWED: readonly UnitId[] = ['q4.tools', 'q4.knowledge'];

export interface QuestionDefinition {
  id: QuestionId;
  index: number;
  /** Формулировка из задания. Не изменять. */
  text: string;
  hint: string;
  shortTitle: string;
  units: readonly [UnitId, UnitId];
}

export const INTRO_TEXT = 'Расскажите о работе сотрудника, которого хотите нанять';

export const QUESTIONS: Record<QuestionId, QuestionDefinition> = {
  q1: {
    id: 'q1',
    index: 0,
    text: 'Какие две-три задачи ежедневно он выполняет?',
    hint: 'Назовите действие и то, с чем сотрудник работает.',
    shortTitle: 'Ежедневные задачи',
    units: ['q1.task1', 'q1.task2'],
  },
  q2: {
    id: 'q2',
    index: 1,
    text: 'Над каким проектом он работает эти 6 месяцев?',
    hint: 'Назовите проект и результат, за который отвечает сотрудник.',
    shortTitle: 'Текущий проект',
    units: ['q2.project', 'q2.contribution'],
  },
  q3: {
    id: 'q3',
    index: 2,
    text: 'В ближайшие полгода он продолжит работать над этим проектом или возьмется за другой? Какой именно?',
    hint: 'Скажите, продолжит ли он текущий проект или перейдёт на другой.',
    shortTitle: 'Следующие полгода',
    units: ['q3.direction', 'q3.project'],
  },
  q4: {
    id: 'q4',
    index: 3,
    text: 'Какими особыми инструментами, программами и знаниями он должен владеть, чтобы эффективно выполнять свою работу?',
    hint: 'Можно сказать, что специальные программы или знания не нужны.',
    shortTitle: 'Инструменты и знания',
    units: ['q4.tools', 'q4.knowledge'],
  },
};

export const UNIT_QUESTION: Record<UnitId, QuestionId> = {
  'q1.task1': 'q1',
  'q1.task2': 'q1',
  'q2.project': 'q2',
  'q2.contribution': 'q2',
  'q3.direction': 'q3',
  'q3.project': 'q3',
  'q4.tools': 'q4',
  'q4.knowledge': 'q4',
};

export const UNIT_LABELS: Record<UnitId, string> = {
  'q1.task1': 'Первая ежедневная задача',
  'q1.task2': 'Вторая ежедневная задача',
  'q2.project': 'Текущий проект',
  'q2.contribution': 'Вклад в проект',
  'q3.direction': 'Продолжит или сменит проект',
  'q3.project': 'Проект на следующие полгода',
  'q4.tools': 'Инструменты и программы',
  'q4.knowledge': 'Знания',
};

/** Шаблоны уточнений из docs/03-semantics.md. */
export const CLARIFICATIONS: Record<UnitId, string> = {
  'q1.task1': 'Назовите одну ежедневную задачу: что сотрудник делает и с чем работает?',
  'q1.task2': 'Какую ещё задачу он выполняет ежедневно?',
  'q2.project': 'Какой проект вы имеете в виду?',
  'q2.contribution': 'За какой результат в этом проекте отвечает сотрудник?',
  'q3.direction': 'Он продолжит текущий проект или перейдёт на другой?',
  'q3.project': 'Как называется или что делает этот проект?',
  'q4.tools': 'Какие программы или инструменты нужны? Можно указать, что специальных инструментов нет.',
  'q4.knowledge': 'Какие специальные знания нужны? Можно указать, что они не требуются.',
};

/** Пробел в описании для каждой незаполненной единицы. */
export const UNIT_GAPS: Record<UnitId, string> = {
  'q1.task1': 'Не указана ежедневная задача.',
  'q1.task2': 'Не указана вторая ежедневная задача.',
  'q2.project': 'Не указан текущий проект.',
  'q2.contribution': 'Не указан вклад сотрудника в текущий проект.',
  'q3.direction': 'Не ясно, продолжит ли сотрудник текущий проект.',
  'q3.project': 'Не указан проект на следующие полгода.',
  'q4.tools': 'Не указаны инструменты и программы.',
  'q4.knowledge': 'Не указаны специальные знания.',
};

export const ROLE_TITLE_GAP = 'Название должности не указано.';
export const CONDITIONS_GAP = 'Условия работы не указаны.';

export const SECTION_IDS = [
  'daily_tasks',
  'current_project',
  'next_six_months',
  'tools',
  'knowledge',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  daily_tasks: 'Ежедневные задачи',
  current_project: 'Текущий проект',
  next_six_months: 'Следующие полгода',
  tools: 'Инструменты',
  knowledge: 'Знания',
};

export const SECTION_QUESTION: Record<SectionId, QuestionId> = {
  daily_tasks: 'q1',
  current_project: 'q2',
  next_six_months: 'q3',
  tools: 'q4',
  knowledge: 'q4',
};

export const DEFAULT_TITLE = 'Описание вакансии';
export const EMPTY_SECTION_TEXT = 'Не указано';
export const GAPS_TITLE = 'Нужно уточнить';
export const EXPORT_FILE_NAME = 'vacancy-description.md';

export const LIMITS = {
  maxRecordingSeconds: 120,
  maxAudioBytes: 10 * 1024 * 1024,
  maxAnswerChars: 4000,
  maxActiveAnswers: 12,
  maxSessionChars: 24000,
  maxJsonBodyBytes: 256 * 1024,
  providerTimeoutMs: 45000,
  maxClarificationsPerQuestion: 2,
  slowNoticeMs: 10000,
  loadingIndicatorDelayMs: 150,
  clientRequestTimeoutMs: 50000,
} as const;

export type Limits = typeof LIMITS;

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_AUDIO',
  'NO_SPEECH',
  'INVALID_MODEL_OUTPUT',
  'INSUFFICIENT_FACTS',
  'STALE_REVISION',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'CONFIGURATION_ERROR',
  'PROVIDER_TIMEOUT',
  /** Расширение контракта: demo не анализирует произвольный текст. */
  'DEMO_UNSUPPORTED_TEXT',
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_AUDIO: 415,
  NO_SPEECH: 422,
  INVALID_MODEL_OUTPUT: 422,
  INSUFFICIENT_FACTS: 422,
  STALE_REVISION: 409,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  CONFIGURATION_ERROR: 503,
  PROVIDER_TIMEOUT: 504,
  DEMO_UNSUPPORTED_TEXT: 422,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

/** Аудиоконтейнеры, которые сервер передаёт провайдеру STT. */
export const SUPPORTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/x-m4a',
] as const;

export function baseMimeType(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}
