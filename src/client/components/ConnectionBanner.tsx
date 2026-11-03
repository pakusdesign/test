import { ActionableNotification, InlineNotification } from '@carbon/react';
import { useActions, useSession } from '../state/store';

/**
 * Сообщение о связи: постоянное, вверху области задачи (N01, N06, N07).
 * Navigator.onLine — только подсказка; функции не блокируются по этому флагу.
 * Во время записи сообщение показывается рядом со статусом записи (N02), здесь — нет.
 */
export function ConnectionBanner() {
  const s = useSession();
  const actions = useActions();
  const { browserOnline, serviceUnreachable, recovered } = s.connection;
  if (s.stage === 'recording' && s.screen === 'question') return null;

  if (!browserOnline || serviceUnreachable) {
    return (
      <div className="connection-banner" data-state-id={s.screen === 'result' ? 'N06' : 'N01'} data-testid="connection-banner">
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          role="status"
          title="Нет связи с сервисом."
          subtitle={s.screen === 'result' ? 'Ответы остаются в этой вкладке. Редактирование, копирование и скачивание работают.' : 'Ответы остаются в этой вкладке.'}
        />
      </div>
    );
  }
  if (recovered) {
    const canRetry = Boolean(s.error?.retryable && s.error.retry && !s.request);
    return (
      <div className="connection-banner" data-state-id="N07" data-testid="connection-banner">
        {canRetry ? (
          <ActionableNotification
            kind="info"
            lowContrast
            inline
            hasFocus={false}
            hideCloseButton
            title="Соединение могло восстановиться."
            subtitle="Повторите действие."
            actionButtonLabel="Повторить"
            onActionButtonClick={() => void actions.retry()}
          />
        ) : (
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            role="status"
            title="Соединение могло восстановиться."
            subtitle="Повторите действие, если оно не завершилось."
          />
        )}
      </div>
    );
  }
  return null;
}
