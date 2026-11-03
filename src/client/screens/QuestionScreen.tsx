/**
 * Экран вопроса: круг, вопрос, ввод голосом или текстом, проверка фактов,
 * уточнения и противоречия (docs/02-ux.md, docs/03-semantics.md).
 */
import { Button, Checkbox, InlineNotification, Tag, TextArea } from '@carbon/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckmarkFilled,
  CircleDash,
  Edit,
  Microphone,
  StopFilledAlt,
  TrashCan,
  WarningAltFilled,
} from '@carbon/icons-react';
import { useMemo, useRef } from 'react';
import { evaluateFacts, unitsByFact, type FactStatus } from '../../shared/completeness';
import {
  CLARIFICATIONS,
  INTRO_TEXT,
  LIMITS,
  QUESTIONS,
  QUESTION_IDS,
  UNIT_LABELS,
  type QuestionId,
} from '../../shared/constants';
import type { Fact } from '../../shared/schemas';
import { recordingSupport } from '../audio/recorder';
import {
  ActionErrorNotice,
  EmptyState,
  GlassPanel,
  RecordingTimer,
  SectionBoundary,
  SlowNotice,
  formatSeconds,
  useDerived,
  useFocusOnChange,
} from '../components/common';
import { DemoTextPicker, modeOf, scenarioOf } from '../components/demo';
import { SessionRing } from '../components/SessionRing';
import { useActions, useIsPreview, useSession } from '../state/store';
import {
  activeAnswersFor,
  currentQuestionId,
  factsInView,
  hasDirtyDrafts,
  isAnalysisFresh,
  unitLabelReason,
} from '../state/transitions';
import type { Answer, SessionState } from '../state/types';

function isBusy(s: SessionState): boolean {
  return Boolean(s.request) || s.stage === 'recording' || s.stage === 'requesting_permission';
}

export function QuestionScreen() {
  const s = useSession();
  const q = currentQuestionId(s);
  const def = QUESTIONS[q];
  const headingRef = useFocusOnChange<HTMLHeadingElement>(q);
  return (
    <GlassPanel className="question-panel" labelledBy="question-title">
      <div className="question-panel__ring">
        <SessionRing />
      </div>
      <div className="question-panel__head" key={q}>
        <p className="question-panel__intro">{INTRO_TEXT}</p>
        <p className="question-panel__counter">Вопрос {def.index + 1} из 4</p>
        <h1 id="question-title" className="question-panel__title" ref={headingRef} tabIndex={-1}>
          {def.text}
        </h1>
        <p className="question-panel__hint">{def.hint}</p>
      </div>
      <SectionBoundary name="Вопрос">
        <QuestionBody q={q} />
      </SectionBoundary>
      <QuestionNav q={q} />
    </GlassPanel>
  );
}

function QuestionBody({ q }: { q: QuestionId }) {
  const s = useSession();
  const error = s.error && s.error.op !== 'copy' && (s.error.questionId === q || s.error.questionId === null) ? s.error : null;
  const hasAnswers = activeAnswersFor(s, q).length > 0;
  return (
    <div className="question-body">
      {error ? <ActionErrorNotice error={error} /> : null}
      {hasAnswers ? <ReviewPanel q={q} /> : <FirstAnswer q={q} />}
      <SlowNotice />
    </div>
  );
}

// ---------- ответ ещё не добавлен ----------

function FirstAnswer({ q }: { q: QuestionId }) {
  const s = useSession();
  const crossFacts = factsInView(s.analysis, s.answers, q);
  const showEmpty = s.stage === 'ready' && !s.pendingAudio;
  return (
    <div className="first-answer">
      {showEmpty ? (
        <EmptyState stateId="S02" title="Ответ пока не добавлен" icon={<CircleDash size={24} />}>
          <p>Нажмите «Записать ответ» и расскажите своими словами. Можно ответить текстом.</p>
        </EmptyState>
      ) : null}
      {crossFacts.length > 0 ? <FactsCard q={q} title="Уже известно из других ответов" /> : null}
      <InputZone q={q} />
    </div>
  );
}

// ---------- зона ввода: кнопки, текст, разрешение, запись ----------

function InputZone({ q }: { q: QuestionId }) {
  const s = useSession();
  switch (s.stage) {
    case 'composing':
      return <Composer q={q} />;
    case 'requesting_permission':
      return <PermissionPanel />;
    case 'recording':
      return <RecordingPanel />;
    case 'recorded':
      return <RecordedPanel />;
    case 'transcribing':
    case 'analyzing':
      return <ProcessingControls />;
    case 'ready':
      return activeAnswersFor(s, q).length === 0 ? <StartAnswerButtons /> : null;
    default:
      return null;
  }
}

function StartAnswerButtons() {
  const s = useSession();
  const actions = useActions();
  const preview = useIsPreview();
  const support = preview ? { ok: true as const } : recordingSupport();
  const scenario = scenarioOf(s);
  return (
    <div className="answer-start">
      {!support.ok ? (
        <div data-state-id="S12">
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Запись недоступна в этом браузере"
            subtitle={support.kind === 'insecure_context' ? 'Микрофон работает только по HTTPS или на localhost. Ответьте текстом.' : 'Браузер не поддерживает запись звука. Ответьте текстом.'}
          />
        </div>
      ) : null}
      <div className="answer-actions">
        {support.ok ? (
          <Button kind="primary" size="lg" renderIcon={Microphone} onClick={() => void actions.startRecording({ kind: 'primary' })}>
            Записать ответ
          </Button>
        ) : null}
        <Button kind="tertiary" size="lg" renderIcon={Edit} onClick={() => actions.openComposer({ kind: 'primary' })}>
          Ответить текстом
        </Button>
      </div>
      {modeOf(s) === 'demo' && scenario ? (
        <p className="demo-hint">
          Демонстрация: запись проверяет микрофон и не отправляется на сервер. После записи можно подставить ответ сценария «{scenario.title}».
        </p>
      ) : null}
    </div>
  );
}

function Composer({ q }: { q: QuestionId }) {
  const s = useSession();
  const actions = useActions();
  const target = s.target;
  const length = s.composerText.length;
  const tooLong = length > LIMITS.maxAnswerChars;
  const label =
    target.kind === 'clarification' && target.unitId ? `Уточнение: ${CLARIFICATIONS[target.unitId]}` : 'Ваш ответ';
  return (
    <div className="composer" data-testid="composer">
      <TextArea
        id="composer-text"
        labelText={label}
        value={s.composerText}
        rows={5}
        autoFocus
        invalid={tooLong}
        invalidText={`Сократите ответ до ${LIMITS.maxAnswerChars} символов. Сейчас ${length}.`}
        helperText={`${length} / ${LIMITS.maxAnswerChars}`}
        placeholder="Например: ежедневно проверяет счета поставщиков и сверяет акты"
        onChange={(e) => actions.setComposerText(e.target.value)}
      />
      {s.composerOrigin === 'fixture' ? (
        <Tag type="purple" size="sm">
          Ответ из тестового сценария
        </Tag>
      ) : null}
      <DemoTextPicker s={s} questionId={q} onPick={(text) => actions.setComposerText(text, 'fixture')} />
      <div className="answer-actions">
        <Button kind="primary" size="lg" onClick={() => void actions.submitComposer()} disabled={Boolean(s.request)}>
          Проверить ответ
        </Button>
        <Button kind="ghost" size="lg" onClick={() => actions.cancelComposer()}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function PermissionPanel() {
  const actions = useActions();
  return (
    <div className="permission-panel" data-state-id="S10" role="status">
      <p className="permission-panel__text">Разрешите доступ к микрофону в браузере</p>
      <p className="permission-panel__hint">Запись начнётся после разрешения. Ответ можно ввести текстом.</p>
      <div className="answer-actions">
        <Button kind="secondary" size="lg" onClick={() => actions.cancelRecording()}>
          Отмена
        </Button>
        <Button kind="ghost" size="lg" renderIcon={Edit} onClick={() => { actions.cancelRecording(); actions.openComposer(); }}>
          Ответить текстом
        </Button>
      </div>
    </div>
  );
}

function RecordingPanel() {
  const s = useSession();
  const actions = useActions();
  const offline = !s.connection.browserOnline || s.connection.serviceUnreachable;
  return (
    <div className="recording-panel" data-testid="recording-panel">
      <div className="recording-status">
        <span className="recording-dot" aria-hidden="true" />
        <span className="recording-status__label">Идёт запись</span>
        {s.recording ? <RecordingTimer startedAt={s.recording.startedAt} maxSeconds={LIMITS.maxRecordingSeconds} /> : null}
      </div>
      {offline ? (
        <p className="recording-offline" data-state-id="N02" role="status">
          Нет связи с сервисом. Запись продолжается в этой вкладке.
        </p>
      ) : null}
      <div className="answer-actions">
        <Button kind="primary" size="lg" renderIcon={StopFilledAlt} onClick={() => void actions.stopRecording()}>
          Завершить запись
        </Button>
        <Button kind="ghost" size="lg" onClick={() => actions.cancelRecording()}>
          Отменить запись
        </Button>
      </div>
    </div>
  );
}

const AUDIO_NOTES = {
  limit_duration: { stateId: 'S16', title: 'Достигнут предел записи', text: 'Запись остановлена через 2 минуты. Записанное сохранено — его можно обработать.' },
  limit_size: { stateId: 'S16', title: 'Достигнут предел записи', text: 'Размер записи достиг 10 МиБ. Записанное сохранено — его можно обработать.' },
  interrupted: { stateId: 'S13', title: 'Запись прервана', text: 'Микрофон отключился. Полученный фрагмент сохранён.' },
} as const;

function RecordedPanel() {
  const s = useSession();
  const actions = useActions();
  const pa = s.pendingAudio;
  const demo = modeOf(s) === 'demo';
  const scenario = scenarioOf(s);
  if (!pa) return null;
  const note = pa.note ? AUDIO_NOTES[pa.note] : null;
  return (
    <div className="recorded-panel" data-testid="recorded-panel">
      {note ? (
        <div data-state-id={note.stateId}>
          <InlineNotification kind="warning" lowContrast hideCloseButton title={note.title} subtitle={note.text} />
        </div>
      ) : null}
      <div className="recorded-panel__audio">
        <audio controls src={pa.url || undefined} aria-label="Прослушать запись" />
        <span className="recorded-panel__meta">
          {formatSeconds(pa.durationMs / 1000)} · {Math.max(1, Math.round(pa.sizeBytes / 1024))} КиБ · {pa.mimeType.split(';')[0]}
        </span>
      </div>
      {demo ? (
        <p className="demo-hint">
          Демонстрация: запись не отправлялась на сервер и не распознавалась. Текст ответа будет взят из сценария «{scenario?.title ?? '—'}» и помечен как «Ответ из тестового сценария».
        </p>
      ) : null}
      <div className="answer-actions">
        {demo ? (
          <Button kind="primary" size="lg" onClick={() => void actions.applyScenarioAnswer(pa.target)}>
            Подставить ответ сценария
          </Button>
        ) : (
          <Button kind="primary" size="lg" onClick={() => void actions.sendRecording()}>
            {pa.note ? 'Обработать записанное' : 'Отправить запись'}
          </Button>
        )}
        <Button kind="tertiary" size="lg" renderIcon={Microphone} onClick={() => void actions.startRecording(pa.target)}>
          Записать заново
        </Button>
        <Button kind="ghost" size="lg" renderIcon={TrashCan} onClick={() => actions.discardRecording()}>
          Удалить запись
        </Button>
        <Button kind="ghost" size="lg" renderIcon={Edit} onClick={() => actions.openComposer(pa.target)}>
          Ответить текстом
        </Button>
      </div>
    </div>
  );
}

function ProcessingControls() {
  const actions = useActions();
  return (
    <div className="processing-controls" data-state-id="S14">
      <Button kind="ghost" size="md" onClick={() => actions.cancelRequest()}>
        Отменить обработку
      </Button>
    </div>
  );
}

// ---------- проверка ответа ----------

function ReviewPanel({ q }: { q: QuestionId }) {
  const s = useSession();
  const actions = useActions();
  const answers = activeAnswersFor(s, q);
  const inactive = s.answers.filter((a) => a.questionId === q && !a.active);
  const fresh = isAnalysisFresh(s);
  const dirty = hasDirtyDrafts(s, q);
  const busy = isBusy(s);
  const { units } = useDerived(s);
  const view = factsInView(s.analysis, s.answers, q);
  const evals = useMemo(() => evaluateFacts(s.analysis, s.answers, s.confirmedFactIds), [s.analysis, s.answers, s.confirmedFactIds]);
  const confirmable = view.filter((f) => {
    const e = evals.get(f.id);
    return e && e.evidenceValid && !e.inConflict;
  });
  const canConfirm = fresh && !dirty && !busy && confirmable.length > 0;
  const firstEditorRef = useRef<HTMLDivElement>(null);
  const focusEditor = () => firstEditorRef.current?.querySelector('textarea')?.focus();
  const questionUnits = units.filter((u) => u.questionId === q);
  const unknownStated = questionUnits.some((u) => u.state === 'unknown');
  const clarifying = s.clarification[q].activeUnit !== null;
  const inInput = ['composing', 'requesting_permission', 'recording', 'recorded'].includes(s.stage);
  const confirmHint = !fresh
    ? 'Сначала дождитесь проверки ответа.'
    : dirty
      ? 'Сначала нажмите «Проверить ответ».'
      : confirmable.length === 0
        ? 'Нет сведений для подтверждения.'
        : null;

  return (
    <div className="review" data-testid="review">
      <div className="review__answers" ref={firstEditorRef}>
        {answers.map((a) => (
          <AnswerEditor key={a.id} answer={a} disabled={busy} />
        ))}
        {inactive.length > 0 ? (
          <p className="review__inactive">Неактуальных ответов: {inactive.length}. Они не участвуют в анализе.</p>
        ) : null}
      </div>

      {!fresh && !s.request && !s.error ? (
        <div className="review__stale">
          <InlineNotification kind="info" lowContrast hideCloseButton title="Ответ ещё не проверен" subtitle="Сведения появятся после проверки." />
          <Button size="md" kind="primary" onClick={() => void actions.reanalyze()}>
            Проверить ответ
          </Button>
        </div>
      ) : null}

      <ConflictPanel q={q} onEdit={focusEditor} />
      <FactsCard q={q} title="Сведения из ответа" />

      <ul className="unit-summary" aria-label="Что известно по вопросу">
        {questionUnits.map((u) => (
          <li key={u.id} className="unit-summary__item" data-valid={u.valid ? 'true' : 'false'}>
            {u.valid ? <CheckmarkFilled size={16} aria-hidden="true" /> : u.reason === 'conflict' ? <WarningAltFilled size={16} aria-hidden="true" /> : <CircleDash size={16} aria-hidden="true" />}
            <span className="unit-summary__label">{UNIT_LABELS[u.id]}</span>
            <span className="unit-summary__reason">{unitLabelReason(u)}</span>
          </li>
        ))}
      </ul>
      {unknownStated ? (
        <p className="review__note">Вы указали, что сведений пока нет. Это честный ответ, но он не повышает полноту.</p>
      ) : null}

      <div className="answer-actions">
        <Button kind="primary" size="lg" renderIcon={CheckmarkFilled} disabled={!canConfirm} onClick={() => actions.confirm()}>
          Подтвердить сведения
        </Button>
        <Button kind="tertiary" size="lg" renderIcon={Edit} disabled={busy} onClick={focusEditor}>
          Исправить
        </Button>
      </div>
      {confirmHint && !busy ? <p className="review__hint">{confirmHint}</p> : null}
      {s.answered[q] === 'confirmed' && !clarifying && !inInput ? (
        <div className="review__done" role="status">
          <CheckmarkFilled size={16} aria-hidden="true" /> Сведения подтверждены.
          <Button size="sm" kind="ghost" disabled={busy} onClick={() => actions.openComposer({ kind: 'clarification', unitId: null })}>
            Дополнить ответ
          </Button>
        </div>
      ) : null}

      {inInput || s.stage === 'transcribing' || s.stage === 'analyzing' ? <InputZone q={q} /> : <ClarificationPanel q={q} hasFacts={view.length > 0} />}
    </div>
  );
}

function answerLabel(a: Answer): string {
  if (a.kind === 'primary') return 'Ответ';
  return a.unitId ? `Уточнение: ${UNIT_LABELS[a.unitId].toLowerCase()}` : 'Дополнение';
}

function OriginTag({ answer }: { answer: Answer }) {
  if (answer.origin === 'fixture') {
    return (
      <Tag type="purple" size="sm">
        Ответ из тестового сценария
      </Tag>
    );
  }
  return (
    <Tag type="cool-gray" size="sm">
      {answer.inputMethod === 'voice' ? 'Голос' : 'Текст'}
    </Tag>
  );
}

function AnswerEditor({ answer, disabled }: { answer: Answer; disabled: boolean }) {
  const s = useSession();
  const actions = useActions();
  const draft = s.drafts[answer.id];
  const value = draft ?? answer.text;
  const changed = draft !== undefined && draft !== answer.text;
  const tooLong = value.length > LIMITS.maxAnswerChars;
  return (
    <div className="answer-card" data-testid="answer-card" data-answer-kind={answer.kind}>
      <div className="answer-card__meta">
        <span className="answer-card__label">{answerLabel(answer)}</span>
        <OriginTag answer={answer} />
        {answer.revision > 1 ? <span className="answer-card__rev">Версия {answer.revision}</span> : null}
      </div>
      <TextArea
        id={`answer-${answer.id}`}
        labelText={`Текст: ${answerLabel(answer).toLowerCase()}`}
        hideLabel
        value={value}
        rows={3}
        disabled={disabled}
        invalid={tooLong}
        invalidText={`Сократите ответ до ${LIMITS.maxAnswerChars} символов. Сейчас ${value.length}.`}
        helperText={changed ? 'Ответ изменён. Нажмите «Проверить ответ». Подтверждение станет доступно после проверки.' : `${value.length} / ${LIMITS.maxAnswerChars}`}
        onChange={(e) => actions.setDraft(answer.id, e.target.value)}
      />
      {changed ? (
        <div className="answer-card__actions">
          <Button size="md" kind="primary" disabled={disabled} onClick={() => void actions.checkAnswer(answer.id)}>
            Проверить ответ
          </Button>
          <Button size="md" kind="ghost" disabled={disabled} onClick={() => actions.resetDraft(answer.id)}>
            Отменить правку
          </Button>
        </div>
      ) : null}
      {modeOf(s) === 'demo' ? (
        <details className="demo-details">
          <summary>Демонстрация: заменить текстом из сценария</summary>
          <DemoTextPicker
            s={s}
            questionId={answer.questionId}
            label="Текст из тестового сценария"
            onPick={(text) => actions.setDraft(answer.id, text, 'fixture')}
          />
        </details>
      ) : null}
    </div>
  );
}

const STATUS_TAG: Record<FactStatus, { text: string; type: 'green' | 'gray' | 'red' | 'magenta' | 'warm-gray' }> = {
  usable: { text: 'Подтверждено', type: 'green' },
  unconfirmed: { text: 'Ждёт подтверждения', type: 'gray' },
  conflict: { text: 'Противоречие', type: 'red' },
  stale_source: { text: 'Ответ изменён', type: 'magenta' },
  dependency: { text: 'Нужна проверка связанного ответа', type: 'warm-gray' },
  invalid: { text: 'Недействительно', type: 'red' },
};

function FactsCard({ q, title }: { q: QuestionId; title: string }) {
  const s = useSession();
  const actions = useActions();
  const fresh = isAnalysisFresh(s);
  const busy = isBusy(s);
  const view = factsInView(s.analysis, s.answers, q);
  const evals = useMemo(() => evaluateFacts(s.analysis, s.answers, s.confirmedFactIds), [s.analysis, s.answers, s.confirmedFactIds]);
  const byFact = useMemo(() => unitsByFact(s.analysis), [s.analysis]);
  const answersById = new Map(s.answers.map((a) => [a.id, a]));
  const own = view.filter((f) => f.questionId === q);
  const other = view.filter((f) => f.questionId !== q);
  const hasText = activeAnswersFor(s, q).some((a) => a.text.trim() !== '');

  const renderFact = (f: Fact) => {
    const e = evals.get(f.id);
    if (!e) return null;
    const units = byFact.get(f.id) ?? [];
    const selectable = e.evidenceValid && !e.inConflict;
    const checked = selectable && !s.excludedFactIds.includes(f.id);
    const status = STATUS_TAG[e.status];
    const ev = f.evidence[0]!;
    const source = answersById.get(ev.answerId);
    return (
      <li key={f.id} className="fact" data-status={e.status} data-testid="fact">
        <Checkbox
          id={`fact-${f.id}`}
          labelText={f.text}
          checked={checked}
          disabled={!selectable || !fresh || busy}
          onChange={(_event, { checked: next }) => actions.setFactIncluded(f.id, next)}
        />
        <div className="fact__meta">
          {units.length > 0 ? (
            units.map((u) => (
              <Tag key={u} type="cool-gray" size="sm">
                {UNIT_LABELS[u]}
              </Tag>
            ))
          ) : (
            <Tag type="warm-gray" size="sm">
              Дополнительно
            </Tag>
          )}
          <Tag type={status.type} size="sm">
            {status.text}
          </Tag>
          {f.questionId !== q ? <span className="fact__other">Вопрос {QUESTIONS[f.questionId].index + 1}</span> : null}
        </div>
        <p className="fact__quote">
          <span className="fact__quote-label">Источник — {source ? answerLabel(source).toLowerCase() : 'ответ'}:</span> «{ev.quote}»
        </p>
        {f.dependsOn.length > 0 && !e.dependenciesUsable ? (
          <p className="fact__dep">Связано с текущим проектом (вопрос 2). Прогресс появится после его подтверждения.</p>
        ) : null}
      </li>
    );
  };

  return (
    <section className="facts-card" aria-labelledby={`facts-${q}`}>
      <h2 className="facts-card__title" id={`facts-${q}`}>
        {title}
      </h2>
      {s.analysisSource ? (
        <p className="facts-card__source">
          {s.analysisSource === 'fixture'
            ? 'Анализ из тестового сценария: фиксированный результат без AI.'
            : 'Сведения выделены автоматически. Проверьте их перед подтверждением.'}
        </p>
      ) : null}
      {own.length === 0 && other.length === 0 && fresh && hasText ? (
        <div data-state-id="S05">
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title="Нужны конкретные сведения о работе сотрудника"
            subtitle="В тексте нет задач, проектов или инструментов. Ответьте на уточнение или продолжите."
          />
        </div>
      ) : null}
      {own.length > 0 ? <ul className="fact-list">{own.map(renderFact)}</ul> : null}
      {other.length > 0 ? (
        <>
          <h3 className="facts-card__subtitle">Относится к другим вопросам</h3>
          <ul className="fact-list">{other.map(renderFact)}</ul>
        </>
      ) : null}
    </section>
  );
}

function ConflictPanel({ q, onEdit }: { q: QuestionId; onEdit: () => void }) {
  const s = useSession();
  const actions = useActions();
  const busy = isBusy(s);
  if (!s.analysis) return null;
  const view = new Set(factsInView(s.analysis, s.answers, q).map((f) => f.id));
  const factsById = new Map(s.analysis.facts.map((f) => [f.id, f]));
  const conflicts = s.analysis.conflicts.filter((c) => c.factIds.some((id) => view.has(id)));
  if (conflicts.length === 0) return null;
  return (
    <div className="conflict-panel" data-state-id="S21">
      {conflicts.map((c, i) => {
        const facts = c.factIds.map((id) => factsById.get(id)).filter((f): f is Fact => Boolean(f));
        const answerIds = [...new Set(facts.map((f) => f.evidence[0]!.answerId))];
        return (
          <div key={i} className="conflict">
            <InlineNotification kind="warning" lowContrast hideCloseButton title="В ответах есть разные варианты" subtitle={c.description} />
            <ul className="conflict__variants">
              {facts.map((f) => {
                const answerId = f.evidence[0]!.answerId;
                return (
                  <li key={f.id} className="conflict__variant">
                    <span className="conflict__text">{f.text}</span>
                    <span className="conflict__quote">«{f.evidence[0]!.quote}»</span>
                    {answerIds.length > 1 ? (
                      <Button size="sm" kind="tertiary" disabled={busy} onClick={() => void actions.keepAnswer(answerId, answerIds)}>
                        Оставить этот вариант
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {answerIds.length === 1 ? (
              <div className="conflict__fix">
                <p>Оба варианта в одном ответе. Исправьте текст, чтобы остался один вариант, и нажмите «Проверить ответ».</p>
                <Button size="md" kind="tertiary" renderIcon={Edit} disabled={busy} onClick={onEdit}>
                  Исправить ответ
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ClarificationPanel({ q, hasFacts }: { q: QuestionId; hasFacts: boolean }) {
  const s = useSession();
  const actions = useActions();
  const preview = useIsPreview();
  const c = s.clarification[q];
  const unit = c.activeUnit;
  const headingRef = useFocusOnChange<HTMLHeadingElement>(unit);
  if (!unit || isBusy(s)) return null;
  const demo = modeOf(s) === 'demo';
  const canRecord = preview || recordingSupport().ok;
  const target = { kind: 'clarification' as const, unitId: unit };
  return (
    <section className="clarification" aria-labelledby="clarification-title" data-testid="clarification" data-unit={unit} data-state-id={hasFacts ? undefined : 'S05'}>
      <p className="clarification__eyebrow">
        Уточнение {c.offered} из {LIMITS.maxClarificationsPerQuestion}
      </p>
      <h2 id="clarification-title" className="clarification__question" ref={headingRef} tabIndex={-1}>
        {CLARIFICATIONS[unit]}
      </h2>
      <div className="answer-actions">
        {canRecord ? (
          <Button kind="primary" size="lg" renderIcon={Microphone} onClick={() => void actions.startRecording(target)}>
            Записать ответ
          </Button>
        ) : null}
        <Button kind="tertiary" size="lg" renderIcon={Edit} onClick={() => actions.openComposer(target)}>
          Дополнить текстом
        </Button>
        {demo ? (
          <Button kind="tertiary" size="lg" onClick={() => void actions.applyScenarioAnswer(target)}>
            Подставить ответ сценария
          </Button>
        ) : null}
        <Button kind="ghost" size="lg" onClick={() => actions.skipClarification()}>
          Продолжить без уточнения
        </Button>
      </div>
    </section>
  );
}

function QuestionNav({ q }: { q: QuestionId }) {
  const s = useSession();
  const actions = useActions();
  const busy = isBusy(s);
  const last = q === 'q4';
  return (
    <nav className="question-nav" aria-label="Навигация по вопросам">
      <Button kind="ghost" size="md" renderIcon={ArrowLeft} disabled={busy} onClick={() => actions.back()}>
        Назад
      </Button>
      <ol className="question-nav__steps">
        {QUESTION_IDS.map((id, i) => (
          <li key={id}>
            <button
              type="button"
              className="question-nav__step"
              data-current={id === q ? 'true' : 'false'}
              data-answered={s.answered[id] ?? 'none'}
              aria-current={id === q ? 'step' : undefined}
              aria-label={`Вопрос ${i + 1}${s.answered[id] === 'confirmed' ? ', проверен' : s.answered[id] === 'skipped' ? ', пропущен' : ''}`}
              disabled={busy}
              onClick={() => actions.goToQuestion(i)}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      {s.answered[q] ? (
        <Button kind="primary" size="md" renderIcon={ArrowRight} disabled={busy} onClick={() => actions.next()}>
          {last ? 'К обзору' : 'Далее'}
        </Button>
      ) : (
        <Button kind="secondary" size="md" disabled={busy} onClick={() => actions.skipQuestion()}>
          {last ? 'Пропустить и к обзору' : 'Пропустить вопрос'}
        </Button>
      )}
    </nav>
  );
}
