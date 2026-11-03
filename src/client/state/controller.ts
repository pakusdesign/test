/**
 * Побочные эффекты сессии: запись, запросы, повтор, отмена, экспорт.
 * Правила: ответ применяется только для активного requestId и текущей ревизии;
 * ручной повтор — новый requestId для того же снимка, без нового Answer;
 * автоматических повторов на клиенте нет; live никогда не переключается в demo.
 */
import { LIMITS, QUESTION_IDS, type QuestionId, type SectionId } from '../../shared/constants';
import { documentToMarkdown } from '../../shared/markdown';
import {
  AnalyzeResponseSchema,
  ConfigResponseSchema,
  GenerateResponseSchema,
  TranscribeResponseSchema,
} from '../../shared/schemas';
import { usableFacts } from '../../shared/completeness';
import { validateAnalysisRelations, validateDocumentRelations } from '../../shared/validation';
import { getJson, postForm, postJson, type HttpFailure } from '../api/http';
import { RecorderError, startRecording, type ActiveRecording, type RecordedAudio } from '../audio/recorder';
import { failureToError, micError } from './messages';
import type { Store } from './store';
import {
  activeAnswersFor,
  applyAnalysis,
  applyDocument,
  beginRequest,
  commitAnswer,
  confirmQuestion,
  currentQuestionId,
  dismissClarification,
  editDocument,
  failRequest,
  goToQuestion,
  isDocumentStale,
  newId,
  resetSession,
  setFactIncluded,
  skipQuestion,
  snapshotOf,
  stageForQuestion,
  supersedeAnswers,
} from './transitions';
import type { ActionError, AudioNote, InputTarget, Operation, RetryPlan, SessionState } from './types';

export interface Actions {
  init(): () => void;
  loadConfig(): Promise<void>;
  selectScenario(id: string): void;
  start(): void;
  goToQuestion(index: number): void;
  next(): void;
  back(): void;
  skipQuestion(): void;
  openOverview(): void;
  openResult(): void;
  openComposer(target?: InputTarget): void;
  setComposerText(text: string, origin?: 'user' | 'fixture'): void;
  cancelComposer(): void;
  submitComposer(): Promise<void>;
  startRecording(target?: InputTarget): Promise<void>;
  stopRecording(): Promise<void>;
  cancelRecording(): void;
  sendRecording(): Promise<void>;
  discardRecording(): void;
  applyScenarioAnswer(target?: InputTarget): Promise<void>;
  retry(): Promise<void>;
  cancelRequest(): void;
  dismissError(): void;
  handleErrorAction(action: string): void;
  setDraft(answerId: string, text: string, origin?: 'user' | 'fixture'): void;
  resetDraft(answerId: string): void;
  checkAnswer(answerId: string): Promise<void>;
  reanalyze(): Promise<void>;
  setFactIncluded(factId: string, included: boolean): void;
  confirm(): void;
  skipClarification(): void;
  keepAnswer(keepAnswerId: string, dropAnswerIds: string[]): Promise<void>;
  generate(force?: boolean): Promise<void>;
  confirmReplaceEdits(): void;
  editTitle(text: string): void;
  editItem(section: SectionId, key: string, text: string): void;
  removeItem(section: SectionId, key: string): void;
  copy(force?: boolean): Promise<void>;
  download(force?: boolean): void;
  confirmStaleExport(): void;
  requestRestart(): void;
  confirmRestart(): void;
  closeModal(): void;
  dismissToast(): void;
}

export interface ControllerDeps {
  /** Только для проверок: доступ к созданным MediaStream. */
  onStream?: (stream: MediaStream) => void;
}

export function createController(store: Store, deps: ControllerDeps = {}): Actions {
  const get = store.getState;
  const set = store.setState;
  let recording: ActiveRecording | null = null;
  let recordingContext: { answerId: string; questionId: QuestionId; target: InputTarget } | null = null;
  let requestAbort: AbortController | null = null;
  let requestOwner: string | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let toastCounter = 0;

  const mode = (): 'demo' | 'live' => {
    const c = get().config;
    return c.status === 'ready' ? c.config.mode : 'live';
  };

  const toast = (text: string) => {
    toastCounter += 1;
    set((s) => ({ ...s, toast: { id: toastCounter, text } }));
  };

  const startSlowTimer = (requestId: string) => {
    requestOwner = requestId;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      set((s) => (s.request?.requestId === requestId ? { ...s, slow: true } : s));
    }, LIMITS.slowNoticeMs);
  };

  const finishRequest = (requestId?: string) => {
    // A late completion may only release its own resources.
    if (requestId !== undefined && requestOwner !== requestId) return;
    clearTimeout(slowTimer);
    requestAbort = null;
    requestOwner = null;
  };

  const handleFailure = (op: Operation, requestId: string, failure: HttpFailure, retry: RetryPlan) => {
    finishRequest(requestId);
    const s = get();
    if (s.request?.requestId !== requestId) return; // устаревший или отменённый запрос
    if (failure.kind === 'aborted') return;
    const error = failureToError(op, failure, { questionId: s.request.questionId, requestId, retry, mode: mode() });
    set((cur) => failRequest(cur, requestId, error, failure.kind === 'network') ?? cur);
  };

  const fallbackStage = (s: SessionState) => (s.pendingAudio ? 'recorded' : stageForQuestion(s, currentQuestionId(s)));

  const releaseAudio = (s: SessionState): SessionState => {
    if (s.pendingAudio) URL.revokeObjectURL(s.pendingAudio.url);
    return { ...s, pendingAudio: null };
  };

  const localError = (error: ActionError) => set((s) => ({ ...s, error }));

  // ---------- анализ ----------

  const analyze = async (q: QuestionId, base?: SessionState) => {
    const requestId = newId('req');
    const s0 = base ?? get();
    const s1 = beginRequest({ ...s0, request: null }, { requestId, op: 'analyze', questionId: q, returnStage: 'review' }, 'analyzing');
    set(s1);
    startSlowTimer(requestId);
    requestAbort = new AbortController();
    const previousFacts = mode() === 'live' && s1.analysis ? s1.analysis.facts.slice(0, 48) : undefined;
    const res = await postJson(
      '/api/analyze',
      { requestId, snapshot: snapshotOf(s1), ...(previousFacts?.length ? { previousFacts } : {}) },
      AnalyzeResponseSchema,
      { signal: requestAbort.signal },
    );
    if (!res.ok) return handleFailure('analyze', requestId, res.failure, { op: 'analyze', questionId: q });
    // Повторная проверка связей на клиенте: повреждённые сведения не показываются.
    const cur = get();
    if (validateAnalysisRelations(res.data.analysis, cur.answers.filter((a) => a.active)).length > 0 && cur.request?.requestId === requestId) {
      return handleFailure('analyze', requestId, { kind: 'invalid_response', status: 200 }, { op: 'analyze', questionId: q });
    }
    finishRequest(requestId);
    set((s) => applyAnalysis(s, res.data) ?? s);
  };

  // ---------- распознавание ----------

  const transcribe = async (opts: { scenarioTarget?: InputTarget } = {}) => {
    const s = get();
    if (s.request) return;
    const q = currentQuestionId(s);
    const pa = s.pendingAudio;
    const target = pa?.target ?? opts.scenarioTarget ?? s.target;
    const answerId = pa?.answerId ?? newId('ans');
    const requestId = newId('req');
    const returnStage = pa ? 'recorded' : stageForQuestion(s, q);
    set(beginRequest(s, { requestId, op: 'transcribe', questionId: q, returnStage }, 'transcribing'));
    startSlowTimer(requestId);
    const form = new FormData();
    form.append('requestId', requestId);
    form.append('sessionRevision', String(s.sessionRevision));
    form.append('answerId', answerId);
    if (mode() === 'live') {
      if (!pa) {
        finishRequest(requestId);
        set((cur) => ({ ...cur, request: null, stage: returnStage }));
        return;
      }
      form.append('audio', pa.blob, `answer.${extensionFor(pa.mimeType)}`);
    } else {
      // Demo: аудио не отправляется; сервер возвращает ответ тестового сценария.
      form.append('scenarioId', s.demoScenarioId);
      form.append('questionId', q);
      if (target.kind === 'clarification' && target.unitId) form.append('unitId', target.unitId);
    }
    requestAbort = new AbortController();
    const res = await postForm('/api/transcribe', form, TranscribeResponseSchema, { signal: requestAbort.signal });
    if (!res.ok) return handleFailure('transcribe', requestId, res.failure, { op: 'transcribe', answerId });
    const cur = get();
    if (cur.request?.requestId !== requestId || res.data.requestId !== requestId) return;
    finishRequest(requestId);
    // Успешная расшифровка: аудио больше не хранится.
    const released = releaseAudio({ ...cur, request: null });
    const { state } = commitAnswer(released, {
      questionId: q,
      target,
      text: res.data.text,
      inputMethod: 'voice',
      origin: res.data.source === 'fixture' ? 'fixture' : 'user',
      answerId,
    });
    await analyze(q, state);
  };

  const handleRecorded = (audio: RecordedAudio, note: AudioNote) => {
    const ctx = recordingContext;
    recordingContext = null;
    if (!ctx) return;
    if (audio.sizeBytes === 0) {
      set((s) => ({ ...s, stage: stageForQuestion(s, ctx.questionId), recording: null }));
      localError({
        op: 'record',
        stateId: 'S04',
        code: 'EMPTY_RECORDING',
        title: 'Не удалось распознать речь',
        message: 'Запись пуста. Запишите ответ ещё раз или введите текст.',
        saved: 'Полнота не изменилась.',
        retryable: false,
        questionId: ctx.questionId,
        actions: ['record_again', 'text'],
      });
      return;
    }
    set((s) => ({
      ...releaseAudio(s),
      recording: null,
      stage: 'recorded',
      pendingAudio: {
        answerId: ctx.answerId,
        questionId: ctx.questionId,
        target: ctx.target,
        blob: audio.blob,
        url: URL.createObjectURL(audio.blob),
        mimeType: audio.mimeType,
        sizeBytes: audio.sizeBytes,
        durationMs: audio.durationMs,
        note,
      },
    }));
    // Live: обычная остановка — сразу отправка. После лимита или прерывания — по кнопке.
    if (mode() === 'live' && note === null) void transcribe();
  };

  // ---------- генерация ----------

  const generate = async (force = false) => {
    const s = get();
    if (s.request) return;
    if (s.document?.isManuallyEdited && !force) {
      set({ ...s, modal: { kind: 'replace_edits' } });
      return;
    }
    const requestId = newId('req');
    set(beginRequest({ ...s, modal: null }, { requestId, op: 'generate', questionId: null, returnStage: s.stage }));
    startSlowTimer(requestId);
    requestAbort = new AbortController();
    const res = await postJson(
      '/api/generate',
      { requestId, snapshot: snapshotOf(s), analysis: s.analysis, confirmedFactIds: s.confirmedFactIds },
      GenerateResponseSchema,
      { signal: requestAbort.signal },
    );
    if (!res.ok) return handleFailure('generate', requestId, res.failure, { op: 'generate' });
    const facts = usableFacts(s.analysis, s.answers, s.confirmedFactIds);
    if (validateDocumentRelations(res.data.document, facts).length > 0) {
      return handleFailure('generate', requestId, { kind: 'invalid_response', status: 200 }, { op: 'generate' });
    }
    finishRequest(requestId);
    set((cur) => applyDocument(cur, res.data) ?? cur);
  };

  const triggerDownload = () => {
    const s = get();
    if (!s.document) return;
    const blob = new Blob([documentToMarkdown(s.document.edited)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vacancy-description.md';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл vacancy-description.md скачан');
  };

  const doCopy = async () => {
    const s = get();
    if (!s.document) return;
    const text = documentToMarkdown(s.document.edited);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      set((cur) => ({ ...cur, error: cur.error?.op === 'copy' ? null : cur.error }));
      toast('Текст скопирован');
    } catch {
      localError({
        op: 'copy',
        stateId: 'S23',
        code: 'CLIPBOARD',
        title: 'Не удалось скопировать текст',
        message: 'Браузер не дал доступ к буферу обмена.',
        saved: 'Текст описания не изменился.',
        retryable: false,
        questionId: null,
        actions: ['select_text', 'download'],
      });
    }
  };

  const actions: Actions = {
    init() {
      const onOffline = () =>
        set((s) => ({ ...s, connection: { ...s.connection, browserOnline: false, recovered: false } }));
      const onOnline = () =>
        set((s) => ({
          ...s,
          connection: {
            browserOnline: true,
            // N07: только подсказка «могло восстановиться»; доступность сервиса неизвестна
            // до следующего запроса. Платный запрос автоматически не запускается.
            serviceUnreachable: false,
            recovered: !s.connection.browserOnline || s.connection.serviceUnreachable,
          },
        }));
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        const s = get();
        if (s.stage === 'recording' || s.answers.length > 0 || s.document) {
          event.preventDefault();
          event.returnValue = '';
        }
      };
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onOnline);
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => {
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('beforeunload', onBeforeUnload);
        recording?.cancel();
        recording = null;
        requestAbort?.abort();
        clearTimeout(slowTimer);
      };
    },

    async loadConfig() {
      set((s) => ({ ...s, config: { status: 'loading' } }));
      const res = await getJson('/api/config', ConfigResponseSchema);
      if (res.ok) {
        set((s) => ({
          ...s,
          config: { status: 'ready', config: res.data },
          demoScenarioId: res.data.demo?.scenarios.some((x) => x.id === s.demoScenarioId)
            ? s.demoScenarioId
            : (res.data.demo?.scenarios[0]?.id ?? s.demoScenarioId),
          connection: { ...s.connection, serviceUnreachable: false },
        }));
      } else {
        set((s) => ({
          ...s,
          config: { status: 'error', message: 'Не удалось подключиться к сервису' },
          connection: { ...s.connection, serviceUnreachable: res.failure.kind === 'network' },
        }));
      }
    },

    selectScenario(id) {
      set((s) => ({ ...s, demoScenarioId: id }));
    },

    start() {
      set((s) => goToQuestion({ ...s, error: null }, 0));
    },

    goToQuestion(index) {
      const s = get();
      if (s.request || s.stage === 'recording' || s.stage === 'requesting_permission') return;
      set(goToQuestion(releaseAudio(s), index));
    },

    next() {
      const s = get();
      if (s.request || s.stage === 'recording') return;
      const q = currentQuestionId(s);
      let next = releaseAudio(s.answered[q] ? s : skipQuestion(s, q));
      next = { ...next, error: null };
      if (s.questionIndex >= QUESTION_IDS.length - 1) set({ ...next, screen: 'overview', progressNote: null });
      else set(goToQuestion(next, s.questionIndex + 1));
    },

    back() {
      const s = get();
      if (s.request || s.stage === 'recording') return;
      if (s.screen === 'result') return set({ ...s, screen: 'overview', error: null });
      if (s.screen === 'overview') return set(goToQuestion({ ...s, error: null }, QUESTION_IDS.length - 1));
      if (s.questionIndex === 0) return set({ ...releaseAudio(s), screen: 'start', error: null });
      set(goToQuestion({ ...releaseAudio(s), error: null }, s.questionIndex - 1));
    },

    skipQuestion() {
      const s = get();
      set(skipQuestion(s, currentQuestionId(s)));
      actions.next();
    },

    openOverview() {
      const s = get();
      if (s.request) return;
      set({ ...releaseAudio(s), screen: 'overview', error: null, progressNote: null });
    },

    openResult() {
      set((s) => (s.document ? { ...s, screen: 'result', error: null } : s));
    },

    openComposer(target) {
      set((s) => ({
        ...s,
        stage: 'composing',
        target: target ?? (s.stage === 'review' ? s.target : { kind: 'primary' }),
        error: s.error?.op === 'record' || s.error?.op === 'input' ? null : s.error,
      }));
    },

    setComposerText(text, origin = 'user') {
      set((s) => ({ ...s, composerText: text, composerOrigin: origin, error: s.error?.op === 'input' ? null : s.error }));
    },

    cancelComposer() {
      set((s) => ({ ...s, stage: fallbackStage(s), composerText: '', composerOrigin: 'user', target: { kind: 'primary' }, error: null }));
    },

    async submitComposer() {
      const s = get();
      if (s.request) return;
      const q = currentQuestionId(s);
      const text = s.composerText;
      if (text.trim() === '') {
        return localError({
          op: 'input',
          stateId: 'S03',
          code: 'EMPTY_ANSWER',
          title: 'Добавьте ответ или продолжите без него',
          message: 'Пустой ответ не отправляется на проверку.',
          saved: 'Другие ответы и прогресс не изменились.',
          retryable: false,
          questionId: q,
          actions: ['continue_without', 'dismiss'],
        });
      }
      if (text.length > LIMITS.maxAnswerChars) {
        return localError({
          op: 'input',
          stateId: 'S16',
          code: 'TOO_LONG',
          title: `Сократите ответ до ${LIMITS.maxAnswerChars} символов`,
          message: `Сейчас ${text.length} символов. Текст не обрезается автоматически.`,
          saved: 'Введённый текст сохранён в поле.',
          retryable: false,
          questionId: q,
          actions: ['dismiss'],
        });
      }
      const target = s.target;
      const base = s.pendingAudio && s.pendingAudio.questionId === q ? releaseAudio(s) : s;
      const { state } = commitAnswer({ ...base, error: null }, {
        questionId: q,
        target,
        text,
        inputMethod: 'text',
        origin: s.composerOrigin,
      });
      await analyze(q, state);
    },

    async startRecording(target) {
      const s = get();
      if (s.request || s.stage === 'recording' || s.stage === 'requesting_permission') return;
      const q = currentQuestionId(s);
      const useTarget = target ?? (s.stage === 'review' ? s.target : { kind: 'primary' as const });
      const released = releaseAudio(s);
      recordingContext = { answerId: newId('ans'), questionId: q, target: useTarget };
      set({ ...released, stage: 'requesting_permission', target: useTarget, error: null });
      let rec: ActiveRecording;
      try {
        rec = await startRecording({
          maxDurationMs: LIMITS.maxRecordingSeconds * 1000,
          maxBytes: LIMITS.maxAudioBytes,
          onStream: deps.onStream,
          onAutoStop: (reason, audio) => {
            recording = null;
            if (!audio) {
              recordingContext = null;
              set((cur) => ({ ...cur, recording: null, stage: stageForQuestion(cur, q) }));
              localError(micError('aborted', q));
              return;
            }
            handleRecorded(audio, reason);
          },
        });
      } catch (error) {
        recordingContext = null;
        if (get().stage !== 'requesting_permission') return; // отменено пользователем
        const kind = error instanceof RecorderError ? error.kind : 'recorder_error';
        set((cur) => ({ ...cur, stage: stageForQuestion(cur, q), error: micError(kind, q) }));
        return;
      }
      if (get().stage !== 'requesting_permission') {
        // Пользователь отменил, пока браузер спрашивал разрешение.
        rec.cancel();
        recordingContext = null;
        return;
      }
      recording = rec;
      set((cur) => ({ ...cur, stage: 'recording', recording: { startedAt: Date.now(), mimeType: rec.mimeType, meter: rec.meter } }));
    },

    async stopRecording() {
      const rec = recording;
      if (!rec) return;
      recording = null;
      try {
        const audio = await rec.stop();
        handleRecorded(audio, null);
      } catch {
        recordingContext = null;
        set((s) => ({ ...s, recording: null, stage: stageForQuestion(s, currentQuestionId(s)) }));
      }
    },

    cancelRecording() {
      const s = get();
      if (s.stage === 'requesting_permission') {
        recordingContext = null;
        set({ ...s, stage: stageForQuestion(s, currentQuestionId(s)) });
        return;
      }
      recording?.cancel();
      recording = null;
      recordingContext = null;
      set((cur) => ({ ...cur, recording: null, stage: stageForQuestion(cur, currentQuestionId(cur)) }));
    },

    async sendRecording() {
      await transcribe();
    },

    discardRecording() {
      set((s) => ({ ...releaseAudio(s), stage: stageForQuestion(s, currentQuestionId(s)), error: null }));
    },

    async applyScenarioAnswer(target) {
      if (mode() !== 'demo') return;
      await transcribe({ scenarioTarget: target });
    },

    async retry() {
      const s = get();
      const plan = s.error?.retry;
      if (!plan || s.request) return;
      set({ ...s, error: null });
      if (plan.op === 'transcribe') await transcribe();
      else if (plan.op === 'analyze') await analyze(plan.questionId);
      else await generate(true);
    },

    cancelRequest() {
      const s = get();
      if (!s.request) return;
      requestAbort?.abort();
      finishRequest();
      // Поздний ответ отменённого запроса не применяется: request сброшен.
      set({ ...s, request: null, slow: false, stage: s.request.returnStage });
    },

    dismissError() {
      set((s) => ({ ...s, error: null }));
    },

    handleErrorAction(action) {
      const s = get();
      const q = currentQuestionId(s);
      switch (action) {
        case 'retry':
          void actions.retry();
          break;
        case 'text':
          actions.openComposer(s.target);
          break;
        case 'record_again':
          set((cur) => ({ ...releaseAudio(cur), error: null }));
          void actions.startRecording(s.target);
          break;
        case 'mic_retry':
          void actions.startRecording(s.target);
          break;
        case 'continue_without':
          set({ ...s, error: null });
          actions.skipQuestion();
          break;
        case 'choose_scenario': {
          const c = s.config.status === 'ready' ? s.config.config : null;
          const scenario = c?.demo?.scenarios.find((x) => x.id === s.demoScenarioId);
          const text = scenario?.answers[q] || c?.demo?.catalog[q]?.[0] || '';
          set({ ...s, error: null, stage: 'composing', composerText: text, composerOrigin: 'fixture' });
          break;
        }
        case 'back_to_answers':
          set(goToQuestion({ ...s, error: null }, Math.max(0, QUESTION_IDS.findIndex((x) => !s.answered[x]))));
          break;
        case 'select_text':
          set({ ...s, error: null, selectExport: s.selectExport + 1 });
          break;
        case 'download':
          set({ ...s, error: null });
          actions.download(true);
          break;
        default:
          actions.dismissError();
      }
    },

    setDraft(answerId, text, origin) {
      set((s) => {
        const drafts = { ...s.drafts, [answerId]: text };
        const answers = origin ? s.answers.map((a) => (a.id === answerId ? { ...a, origin } : a)) : s.answers;
        return { ...s, drafts, answers, error: s.error?.op === 'input' ? null : s.error };
      });
    },

    resetDraft(answerId) {
      set((s) => {
        const drafts = { ...s.drafts };
        delete drafts[answerId];
        return { ...s, drafts };
      });
    },

    async checkAnswer(answerId) {
      const s = get();
      if (s.request) return;
      const answer = s.answers.find((a) => a.id === answerId);
      if (!answer) return;
      const text = s.drafts[answerId] ?? answer.text;
      if (text.trim() === '') {
        return localError({
          op: 'input',
          stateId: 'S03',
          code: 'EMPTY_ANSWER',
          title: 'Добавьте ответ или продолжите без него',
          message: 'Пустой ответ не отправляется на проверку. Чтобы убрать сведения, снимите отметку с фактов.',
          saved: 'Прежний текст ответа сохранён.',
          retryable: false,
          questionId: answer.questionId,
          actions: ['continue_without', 'dismiss'],
        });
      }
      if (text.length > LIMITS.maxAnswerChars) {
        return localError({
          op: 'input',
          stateId: 'S16',
          code: 'TOO_LONG',
          title: `Сократите ответ до ${LIMITS.maxAnswerChars} символов`,
          message: `Сейчас ${text.length} символов. Текст не обрезается автоматически.`,
          saved: 'Введённый текст сохранён в поле.',
          retryable: false,
          questionId: answer.questionId,
          actions: ['dismiss'],
        });
      }
      if (text === answer.text) {
        actions.resetDraft(answerId);
        return analyze(answer.questionId);
      }
      const { state } = commitAnswer(s, {
        questionId: answer.questionId,
        target: answer.kind === 'clarification' ? { kind: 'clarification', unitId: answer.unitId } : { kind: 'primary' },
        text,
        inputMethod: answer.inputMethod,
        origin: answer.origin,
        answerId,
      });
      await analyze(answer.questionId, state);
    },

    async reanalyze() {
      const s = get();
      if (s.request) return;
      await analyze(currentQuestionId(s));
    },

    setFactIncluded(factId, included) {
      set((s) => setFactIncluded(s, factId, included));
    },

    confirm() {
      const s = get();
      if (s.request) return;
      set(confirmQuestion({ ...s, error: null }, currentQuestionId(s)));
    },

    skipClarification() {
      const s = get();
      set(dismissClarification(s, currentQuestionId(s)));
      actions.next();
    },

    async keepAnswer(keepAnswerId, dropAnswerIds) {
      const s = get();
      if (s.request) return;
      const drop = dropAnswerIds.filter((id) => id !== keepAnswerId);
      const next = supersedeAnswers(s, drop);
      await analyze(currentQuestionId(s), next);
    },

    generate(force) {
      return generate(force);
    },

    confirmReplaceEdits() {
      void generate(true);
    },

    editTitle(text) {
      set((s) => editDocument(s, (d) => ({ ...d, title: text })));
    },

    editItem(section, key, text) {
      set((s) =>
        editDocument(s, (d) => ({
          ...d,
          sections: d.sections.map((sec) =>
            sec.id === section ? { ...sec, items: sec.items.map((i) => (i.key === key ? { ...i, text } : i)) } : sec,
          ),
        })),
      );
    },

    removeItem(section, key) {
      set((s) =>
        editDocument(s, (d) => ({
          ...d,
          sections: d.sections.map((sec) => (sec.id === section ? { ...sec, items: sec.items.filter((i) => i.key !== key) } : sec)),
        })),
      );
    },

    async copy(force = false) {
      const s = get();
      if (!force && isDocumentStale(s)) return set({ ...s, modal: { kind: 'export_stale', action: 'copy' } });
      await doCopy();
    },

    download(force = false) {
      const s = get();
      if (!force && isDocumentStale(s)) return set({ ...s, modal: { kind: 'export_stale', action: 'download' } });
      triggerDownload();
    },

    confirmStaleExport() {
      const s = get();
      const modal = s.modal;
      set({ ...s, modal: null });
      if (modal?.kind !== 'export_stale') return;
      if (modal.action === 'copy') void doCopy();
      else triggerDownload();
    },

    requestRestart() {
      set((s) => ({ ...s, modal: { kind: 'restart' } }));
    },

    confirmRestart() {
      requestAbort?.abort();
      finishRequest();
      recording?.cancel();
      recording = null;
      recordingContext = null;
      set((s) => resetSession(releaseAudio({ ...s, modal: null })));
    },

    closeModal() {
      set((s) => ({ ...s, modal: null }));
    },

    dismissToast() {
      set((s) => ({ ...s, toast: null }));
    },
  };
  return actions;
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export { activeAnswersFor };
