import type { QuestionId, UnitId } from '../../shared/constants';
import type { AudioMeter } from '../audio/level';
import type { AnswerRef } from '../../shared/completeness';
import type { EditableDocument } from '../../shared/markdown';
import type { Analysis, ConfigResponse, ResultSource, VacancyDocument } from '../../shared/schemas';

export type ConfigState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: ConfigResponse };

export type InputMethod = 'voice' | 'text';

export interface Answer extends AnswerRef {
  kind: 'primary' | 'clarification';
  unitId: UnitId | null;
  inputMethod: InputMethod;
  /** fixture — текст взят из тестового сценария demo. */
  origin: 'user' | 'fixture';
}

export type Screen = 'start' | 'question' | 'overview' | 'result';

/** Этап текущего вопроса (docs/02-ux.md). Ошибка — отдельный слой поверх этапа. */
export type Stage =
  | 'ready'
  | 'composing'
  | 'requesting_permission'
  | 'recording'
  | 'recorded'
  | 'transcribing'
  | 'analyzing'
  | 'review';

export type InputTarget = { kind: 'primary' } | { kind: 'clarification'; unitId: UnitId | null };

export type AudioNote = 'limit_duration' | 'limit_size' | 'interrupted' | null;

export interface PendingAudio {
  answerId: string;
  questionId: QuestionId;
  target: InputTarget;
  blob: Blob;
  url: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  note: AudioNote;
}

export type Operation = 'transcribe' | 'analyze' | 'generate';

export interface ActiveRequest {
  requestId: string;
  op: Operation;
  startedAt: number;
  sessionRevision: number;
  factsRevision: number;
  questionId: QuestionId | null;
  /** Состояние экрана, к которому вернуться при отмене. */
  returnStage: Stage;
}

export type ErrorActionId =
  | 'retry'
  | 'text'
  | 'record_again'
  | 'continue_without'
  | 'choose_scenario'
  | 'back_to_answers'
  | 'select_text'
  | 'download'
  | 'mic_retry'
  | 'dismiss';

export interface ActionError {
  op: Operation | 'record' | 'input' | 'copy';
  /** Код S/N из docs/11-interface-states.md — для проверки и галереи. */
  stateId: string;
  code: string;
  title: string;
  message: string;
  saved: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  requestId?: string;
  questionId: QuestionId | null;
  actions: ErrorActionId[];
  /** Повтор: что именно отправить снова (тот же снимок, новый requestId). */
  retry?: RetryPlan;
}

export type RetryPlan =
  | { op: 'transcribe'; answerId: string }
  | { op: 'analyze'; questionId: QuestionId }
  | { op: 'generate' };

export interface DocState {
  generatedAtRevision: number;
  generatedAtFactsRevision: number;
  generated: VacancyDocument;
  edited: EditableDocument;
  isManuallyEdited: boolean;
  source: ResultSource;
}

export type Modal =
  | { kind: 'restart' }
  | { kind: 'replace_edits' }
  | { kind: 'export_stale'; action: 'copy' | 'download' };

export interface ClarificationState {
  offered: number;
  activeUnit: UnitId | null;
  dismissed: boolean;
}

export interface ConnectionState {
  browserOnline: boolean;
  /** Последний запрос не дошёл до сервиса (сетевая ошибка без ответа). */
  serviceUnreachable: boolean;
  /** Браузер сообщил о восстановлении после потери сети (N07). */
  recovered: boolean;
}

export interface SessionState {
  config: ConfigState;
  demoScenarioId: string;
  screen: Screen;
  questionIndex: number;
  stage: Stage;
  target: InputTarget;
  composerText: string;
  composerOrigin: 'user' | 'fixture';
  recording: { startedAt: number; mimeType: string; meter: AudioMeter | null } | null;
  pendingAudio: PendingAudio | null;
  sessionRevision: number;
  factsRevision: number;
  answers: Answer[];
  drafts: Record<string, string>;
  analysis: Analysis | null;
  analysisRevision: number | null;
  analysisSource: ResultSource | null;
  confirmedFactIds: string[];
  excludedFactIds: string[];
  answered: Record<QuestionId, 'confirmed' | 'skipped' | null>;
  clarification: Record<QuestionId, ClarificationState>;
  request: ActiveRequest | null;
  slow: boolean;
  error: ActionError | null;
  connection: ConnectionState;
  progressNote: string | null;
  document: DocState | null;
  modal: Modal | null;
  toast: { id: number; text: string } | null;
  /** Показать поле Markdown выделенным (ручное копирование, S23). */
  selectExport: number;
}
