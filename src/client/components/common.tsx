import { Button, InlineNotification } from '@carbon/react';
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  completenessFromUnits,
  questionStatuses,
  validUnitVector,
} from '../../shared/completeness';
import { QUESTION_IDS } from '../../shared/constants';
import { useActions, useSession } from '../state/store';
import { unitsOf } from '../state/transitions';
import type { ActionError, ErrorActionId, SessionState } from '../state/types';

export function GlassPanel({ children, className, as = 'section', labelledBy }: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'aside';
  labelledBy?: string;
}) {
  const Tag = as;
  return (
    <Tag className={['app-glass', className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      {children}
    </Tag>
  );
}

export function useDerived(s: SessionState) {
  return useMemo(() => {
    const units = unitsOf(s);
    const vector = validUnitVector(units);
    const completeness = completenessFromUnits(units);
    const answeredCount = QUESTION_IDS.filter((q) => s.answered[q] !== null).length;
    return { units, vector, completeness, statuses: questionStatuses(units), answeredCount };
    // Зависимости — только входы расчёта полноты.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.analysis, s.answers, s.confirmedFactIds, s.answered]);
}

const ACTION_LABELS: Record<ErrorActionId, string> = {
  retry: 'Повторить',
  text: 'Ответить текстом',
  record_again: 'Записать ещё раз',
  continue_without: 'Продолжить без ответа',
  choose_scenario: 'Подставить текст сценария',
  back_to_answers: 'Вернуться к ответам',
  select_text: 'Выделить текст',
  download: 'Скачать Markdown',
  mic_retry: 'Повторить',
  dismiss: 'Понятно',
};

/** Контекстная ошибка действия: что не удалось, что сохранилось, что можно сделать. */
export function ActionErrorNotice({ error, compact }: { error: ActionError; compact?: boolean }) {
  const actions = useActions();
  const s = useSession();
  const offline = !s.connection.browserOnline;
  const primary = error.actions[0];
  const rest = error.actions.slice(1);
  return (
    <div className="action-error" data-state-id={error.stateId} data-testid="action-error">
      <InlineNotification
        kind={error.stateId === 'S03' || error.stateId === 'DEMO' ? 'warning' : 'error'}
        role="alert"
        title={error.title}
        subtitle={`${error.message} ${error.saved}`.trim()}
        hideCloseButton
        lowContrast
      />
      {offline && error.retryable ? (
        <p className="action-error__hint">Браузер сообщает, что сети нет. Повтор может не пройти.</p>
      ) : null}
      <div className="action-error__actions">
        {primary ? (
          <Button size="md" kind={primary === 'dismiss' ? 'secondary' : 'primary'} onClick={() => actions.handleErrorAction(primary)}>
            {primary === 'retry' && error.op === 'transcribe' && error.stateId === 'N03' ? 'Повторить отправку' : ACTION_LABELS[primary]}
          </Button>
        ) : null}
        {rest.map((a) => (
          <Button key={a} size="md" kind="tertiary" onClick={() => actions.handleErrorAction(a)}>
            {ACTION_LABELS[a]}
          </Button>
        ))}
        {!compact && error.actions.includes('dismiss') === false && error.op !== 'copy' ? (
          <Button size="md" kind="ghost" onClick={() => actions.dismissError()}>
            Скрыть
          </Button>
        ) : null}
      </div>
      {error.requestId || error.code ? (
        <details className="action-error__details">
          <summary>Сведения для поддержки</summary>
          <p>
            Код: {error.code}
            {error.requestId ? <> · requestId: <code>{error.requestId}</code></> : null}
          </p>
        </details>
      ) : null}
    </div>
  );
}

/** S15: обработка дольше 10 секунд. */
export function SlowNotice() {
  const s = useSession();
  const actions = useActions();
  if (!s.request || !s.slow) return null;
  return (
    <div className="slow-notice" data-state-id="S15">
      <InlineNotification
        kind="info"
        lowContrast
        hideCloseButton
        title="Обработка занимает больше времени."
        subtitle="Можно подождать или отменить."
      />
      <Button size="sm" kind="tertiary" onClick={() => actions.cancelRequest()}>
        Отменить
      </Button>
    </div>
  );
}

/** Пустое состояние с действием (S02, S06, S07). */
export function EmptyState({ stateId, title, children, icon }: { stateId: string; title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state" data-state-id={stateId}>
      {icon ? <div className="empty-state__icon" aria-hidden="true">{icon}</div> : null}
      <p className="empty-state__title">{title}</p>
      {children ? <div className="empty-state__body">{children}</div> : null}
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
  attempt: number;
}

/** S25: ошибка отрисовки раздела. Состояние сессии хранится выше и не теряется. */
export class SectionBoundary extends Component<{ children: ReactNode; name: string }, BoundaryState> {
  state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Раздел «${this.props.name}» не отрисован`, error.name, info.componentStack?.split('\n')[1]?.trim());
  }

  render() {
    if (this.state.error) {
      return (
        <div className="section-error" data-state-id="S25" role="alert">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            role="status"
            title="Не удалось показать этот раздел"
            subtitle="Ответы и описание сохранены в этой вкладке."
          />
          <Button size="md" kind="primary" onClick={() => this.setState((st) => ({ error: null, attempt: st.attempt + 1 }))}>
            Повторить
          </Button>
        </div>
      );
    }
    return <div key={this.state.attempt} className="section-boundary">{this.props.children}</div>;
  }
}

/** Таймер записи: обновление 4 раза в секунду, без влияния на полноту. */
export function RecordingTimer({ startedAt, maxSeconds }: { startedAt: number; maxSeconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.min(maxSeconds, Math.floor((now - startedAt) / 1000)));
  return (
    <span className="recording-timer" aria-label={`Прошло ${elapsed} секунд из ${maxSeconds}`}>
      {formatSeconds(elapsed)} / {formatSeconds(maxSeconds)}
    </span>
  );
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Перевод фокуса на заголовок при открытии экрана и смене вопроса (docs/02-ux.md). */
export function useFocusOnChange<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (key === null || key === undefined) return;
    ref.current?.focus({ preventScroll: false });
  }, [key]);
  return ref;
}
