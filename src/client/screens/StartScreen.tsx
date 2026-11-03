import { Button, InlineNotification, Select, SelectItem } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { INTRO_TEXT } from '../../shared/constants';
import { GlassPanel } from '../components/common';
import { configOf, scenarioOf } from '../components/demo';
import { SessionRing } from '../components/SessionRing';
import { useActions, useSession } from '../state/store';

/** S01 / S09: нулевое состояние. Микрофон до нажатия не запрашивается. */
export function StartScreen() {
  const s = useSession();
  const actions = useActions();
  const config = configOf(s);
  const scenario = scenarioOf(s);
  const liveMissing =
    config?.mode === 'live' && config.live
      ? [!config.live.sttConfigured && 'распознавание речи (DEEPGRAM_API_KEY)', !config.live.llmConfigured && 'анализ и генерация (ANTHROPIC_API_KEY, LLM_MODEL)'].filter(Boolean)
      : [];
  return (
    <GlassPanel className="start-panel" labelledBy="start-title">
      <div className="start-panel__ring">
        <SessionRing />
      </div>
      <div className="start-panel__body" data-state-id="S01">
        <h1 id="start-title" className="start-panel__title" tabIndex={-1}>
          Создайте описание вакансии
        </h1>
        <p className="start-panel__lead">Ответьте на четыре вопроса голосом или текстом.</p>
        <p className="start-panel__intro">{INTRO_TEXT}.</p>
        <ul className="start-panel__facts">
          <li>Система выделит факты и покажет, чего не хватает.</li>
          <li>Вы проверите сведения. В описание попадут только подтверждённые факты.</li>
          <li>Ответы хранятся до закрытия или обновления страницы. Скачайте готовое описание.</li>
        </ul>
        {config?.mode === 'live' ? (
          <p className="start-panel__notice">
            Аудио будет отправлено сервису распознавания. Текст будет отправлен сервису генерации.
          </p>
        ) : null}
        {liveMissing.length > 0 ? (
          <div data-state-id="S24">
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title="Обработка сейчас недоступна"
              subtitle={`Live-режим не настроен: ${liveMissing.join('; ')}. Ответы можно ввести, но анализ вернёт ошибку. Демонстрация не включается автоматически.`}
            />
          </div>
        ) : null}
        {config?.mode === 'demo' && config.demo ? (
          <div className="start-panel__scenario">
            <Select
              id="demo-scenario"
              labelText="Тестовый сценарий демонстрации"
              helperText={scenario?.description}
              value={s.demoScenarioId}
              onChange={(e) => actions.selectScenario(e.target.value)}
            >
              {config.demo.scenarios.map((sc) => (
                <SelectItem key={sc.id} value={sc.id} text={sc.title} />
              ))}
            </Select>
            <p className="demo-hint">
              В демонстрации ответы и анализ берутся из тестовых сценариев. Внешние сервисы не вызываются. Это не AI-обработка.
            </p>
          </div>
        ) : null}
        <div className="answer-actions">
          <Button kind="primary" size="lg" renderIcon={ArrowRight} onClick={() => actions.start()}>
            Начать
          </Button>
        </div>
      </div>
    </GlassPanel>
  );
}

/** S26: конфигурация не загружена. Режим не предполагается. */
export function ConfigErrorScreen() {
  const actions = useActions();
  return (
    <GlassPanel className="start-panel" labelledBy="config-error-title">
      <div className="start-panel__body" data-state-id="S26">
        <h1 id="config-error-title" className="start-panel__title">
          Не удалось подключиться к сервису
        </h1>
        <p className="start-panel__lead">Сервер не вернул настройки. Режим demo или live не выбран.</p>
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          role="status"
          title="Нет связи с сервисом."
          subtitle="Проверьте, что сервер запущен (npm run dev или npm start), и повторите."
        />
        <div className="answer-actions">
          <Button kind="primary" size="lg" onClick={() => void actions.loadConfig()}>
            Повторить
          </Button>
        </div>
      </div>
    </GlassPanel>
  );
}

export function ConfigLoadingScreen() {
  return (
    <GlassPanel className="start-panel">
      <div className="start-panel__body" role="status">
        <p className="start-panel__lead">Загружаем настройки…</p>
      </div>
    </GlassPanel>
  );
}
