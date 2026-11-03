import { Button, Modal, Tag, ToastNotification, Tooltip } from '@carbon/react';
import { Information, Restart } from '@carbon/icons-react';
import type { ReactNode } from 'react';
import { ConnectionBanner } from './components/ConnectionBanner';
import { SectionBoundary } from './components/common';
import { configOf } from './components/demo';
import { OverviewScreen } from './screens/OverviewScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { ResultScreen } from './screens/ResultScreen';
import { ConfigErrorScreen, ConfigLoadingScreen, StartScreen } from './screens/StartScreen';
import { useActions, useSession } from './state/store';

function ModeTag() {
  const s = useSession();
  const config = configOf(s);
  if (!config) return null;
  if (config.mode === 'demo') {
    return (
      <div className="mode-tag" data-testid="mode-tag" data-mode="demo">
        <Tag type="purple" size="md">
          Демонстрация
        </Tag>
        <Tooltip label="Ответы, анализ и описание берутся из тестовых сценариев. Внешние сервисы не вызываются." align="bottom-end">
          <button type="button" className="mode-tag__info" aria-label="Что значит «Демонстрация»">
            <Information size={16} />
          </button>
        </Tooltip>
      </div>
    );
  }
  const ready = config.live?.sttConfigured && config.live.llmConfigured;
  return (
    <div className="mode-tag" data-testid="mode-tag" data-mode="live">
      <Tag type={ready ? 'green' : 'red'} size="md">
        {ready ? 'Live' : 'Live не настроен'}
      </Tag>
    </div>
  );
}

function Header() {
  const s = useSession();
  const actions = useActions();
  const hasWork = s.answers.length > 0 || s.document !== null || s.pendingAudio !== null;
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <span className="app-header__brand">Бриф вакансии</span>
        <ModeTag />
        <div className="app-header__spacer" />
        {hasWork ? (
          <Button kind="ghost" size="md" renderIcon={Restart} onClick={() => actions.requestRestart()}>
            Начать заново
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function Modals() {
  const s = useSession();
  const actions = useActions();
  const modal = s.modal;
  return (
    <>
      <Modal
        open={modal?.kind === 'restart'}
        danger
        modalHeading="Начать заново?"
        primaryButtonText="Удалить и начать заново"
        secondaryButtonText="Отмена"
        onRequestSubmit={() => actions.confirmRestart()}
        onRequestClose={() => actions.closeModal()}
        size="sm"
      >
        <p>Ответы, факты, запись и описание будут удалены из этой вкладки. Это нельзя отменить.</p>
      </Modal>
      <Modal
        open={modal?.kind === 'replace_edits'}
        modalHeading="Заменить ручные правки?"
        primaryButtonText="Заменить текст"
        secondaryButtonText="Отмена"
        onRequestSubmit={() => actions.confirmReplaceEdits()}
        onRequestClose={() => actions.closeModal()}
        size="sm"
      >
        <p>Новое описание заменит текст, который вы изменили вручную. При отмене текущий текст останется без изменений.</p>
      </Modal>
      <Modal
        open={modal?.kind === 'export_stale'}
        modalHeading="Описание устарело"
        primaryButtonText={modal?.kind === 'export_stale' && modal.action === 'copy' ? 'Всё равно копировать' : 'Всё равно скачать'}
        secondaryButtonText="Отмена"
        onRequestSubmit={() => actions.confirmStaleExport()}
        onRequestClose={() => actions.closeModal()}
        size="sm"
      >
        <p>Ответы изменились после создания описания. Текст может не совпадать с подтверждёнными сведениями. Обновите описание или экспортируйте прежний текст.</p>
      </Modal>
    </>
  );
}

function Toasts() {
  const s = useSession();
  const actions = useActions();
  if (!s.toast) return null;
  return (
    <div className="toast-area">
      <ToastNotification
        key={s.toast.id}
        kind="success"
        lowContrast
        title={s.toast.text}
        timeout={4000}
        onClose={() => {
          actions.dismissToast();
          return true;
        }}
      />
    </div>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app-root">
      <div className="app-backdrop" aria-hidden="true" />
      <Header />
      <main id="main" className="app-main">
        <ConnectionBanner />
        {children}
      </main>
      <Modals />
      <Toasts />
    </div>
  );
}

export function AppView() {
  const s = useSession();
  let content: ReactNode;
  if (s.config.status === 'loading') content = <ConfigLoadingScreen />;
  else if (s.config.status === 'error') content = <ConfigErrorScreen />;
  else if (s.screen === 'start') content = <StartScreen />;
  else if (s.screen === 'question') content = <QuestionScreen />;
  else if (s.screen === 'overview') content = <OverviewScreen />;
  else content = <ResultScreen />;
  return (
    <AppFrame>
      <SectionBoundary name="Экран">{content}</SectionBoundary>
    </AppFrame>
  );
}
