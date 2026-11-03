import { STAGE_LABELS } from '../state/messages';
import { useSession } from '../state/store';
import { currentQuestionId, isDocumentStale } from '../state/transitions';
import { useReducedMotion } from '../hooks/useMediaQuery';
import { useDerived } from './common';
import { VacancyProgressRing, type RingStage } from './ring/VacancyProgressRing';

/** Связывает состояние сессии с кругом. Источники: полнота, сигнал микрофона, активный запрос. */
export function SessionRing({ className }: { className?: string }) {
  const s = useSession();
  const reducedMotion = useReducedMotion();
  const { vector, completeness, answeredCount } = useDerived(s);
  const q = s.screen === 'question' ? currentQuestionId(s) : null;
  const clarifying = q ? s.clarification[q].activeUnit !== null : false;

  let stage: RingStage = 'ready';
  let statusText: string | null = null;
  if (s.screen === 'start') {
    stage = 'start';
    statusText = 'Ответьте на четыре вопроса';
  } else if (s.request) {
    stage = 'processing';
  } else if (s.stage === 'recording') {
    stage = 'recording';
    statusText = 'Идёт запись';
  } else if (s.stage === 'requesting_permission') {
    stage = 'permission';
    statusText = 'Разрешите доступ к микрофону';
  } else if (s.error && s.error.op !== 'copy') {
    stage = 'error';
  } else if (s.screen === 'result') {
    stage = 'result';
    statusText =
      completeness < 100
        ? 'Черновик готов. Есть пропуски'
        : (s.document?.edited.gaps.length ?? 0) > 0
          ? 'Черновик готов. Проверьте «Нужно уточнить»'
          : 'Черновик готов';
    if (isDocumentStale(s)) statusText = 'Ответы изменились. Обновите описание';
  } else if (s.screen === 'question' && s.stage === 'review') {
    stage = clarifying ? 'clarification' : 'review';
    statusText = clarifying ? 'Нужно уточнение' : q && s.answered[q] ? null : 'Проверьте сведения';
  } else if (s.screen === 'question') {
    statusText = s.stage === 'recorded' ? 'Запись готова' : 'Нажмите и расскажите';
  }
  if (completeness === 100 && !s.request && stage !== 'recording' && s.screen !== 'result') {
    statusText = 'Данных по четырём вопросам достаточно';
  }

  const online = s.connection.browserOnline && !s.connection.serviceUnreachable;
  return (
    <VacancyProgressRing
      className={className}
      validConfirmedUnits={vector}
      stage={stage}
      activeQuestionId={q}
      answeredCount={answeredCount}
      connectionState={online ? 'online' : 'offline'}
      reducedMotion={reducedMotion}
      audioMeter={s.recording?.meter ?? null}
      processing={s.request ? { key: s.request.requestId, label: STAGE_LABELS[s.request.op] } : null}
      statusText={statusText}
      note={s.progressNote}
    />
  );
}
