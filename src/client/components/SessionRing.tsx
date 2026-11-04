import { CLARIFICATIONS, QUESTION_IDS, QUESTIONS } from '../../shared/constants';
import { STAGE_LABELS } from '../state/messages';
import { useSession } from '../state/store';
import { currentQuestionId, isDocumentStale } from '../state/transitions';
import { useReducedMotion } from '../hooks/useMediaQuery';
import { useDerived } from './common';
import { VacancyProgressRing, type RingStage } from './ring/VacancyProgressRing';

/**
 * Связывает состояние сессии с кругом. Источники: полнота, результат последней
 * проверки каждого вопроса (предложенное уточнение), сигнал микрофона, активный запрос.
 */
export function SessionRing({ className }: { className?: string }) {
  const s = useSession();
  const reducedMotion = useReducedMotion();
  const { vector, completeness, answeredCount } = useDerived(s);
  const q = s.screen === 'question' ? currentQuestionId(s) : null;
  const n = q ? QUESTIONS[q].index + 1 : 0;
  const clarifyUnit = q ? s.clarification[q].activeUnit : null;
  const clarifying = clarifyUnit !== null;
  // Предупреждение держится, пока приложение просит уточнение по вопросу,
  // в том числе на других вопросах, в обзоре и в результате.
  const attention = QUESTION_IDS.filter((id) => s.clarification[id].activeUnit !== null);

  let stage: RingStage = 'ready';
  let statusText: string | null = null;
  let statusDetail: string | null = null;
  if (s.screen === 'start') {
    stage = 'start';
    statusText = 'Ответьте на четыре вопроса';
  } else if (s.request) {
    stage = 'processing';
  } else if (s.stage === 'recording') {
    stage = 'recording';
    statusText = s.target.kind === 'clarification' ? 'Записываем уточнение' : `Идёт запись · вопрос ${n} из 4`;
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
    statusText = clarifying ? `Вопрос ${n} · нужно уточнение` : q && s.answered[q] ? null : 'Проверьте сведения';
    statusDetail = clarifyUnit ? CLARIFICATIONS[clarifyUnit] : null;
  } else if (s.screen === 'question') {
    statusText = s.stage === 'recorded' ? 'Запись готова' : null;
  }
  if (completeness === 100 && !s.request && stage !== 'recording' && s.screen !== 'result') {
    statusText = 'Данных по четырём вопросам достаточно';
    statusDetail = null;
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
      attentionQuestionIds={attention}
      audioMeter={s.recording?.meter ?? null}
      processing={s.request ? { key: s.request.requestId, label: STAGE_LABELS[s.request.op] } : null}
      statusText={statusText}
      statusDetail={statusDetail}
      note={s.progressNote}
    />
  );
}
