/**
 * Галерея разработки (DES06, MOT12): компоненты, круг, все S01–S26 и N01–N10.
 * Доступна только в dev-сборке (#/gallery). Платные API не вызываются.
 */
import {
  Accordion,
  AccordionItem,
  ActionableNotification,
  Button,
  Checkbox,
  InlineLoading,
  InlineNotification,
  Modal,
  SkeletonText,
  Tag,
  TextArea,
  TextInput,
  Toggle,
  ToastNotification,
  Tooltip,
} from '@carbon/react';
import { Add, Microphone } from '@carbon/icons-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QUESTION_IDS, UNIT_IDS, UNIT_LABELS, type QuestionId } from '../../shared/constants';
import { AppFrame, AppView } from '../AppView';
import { EmptyState, GlassPanel, SectionBoundary } from '../components/common';
import { VacancyProgressRing, type RingStage } from '../components/ring/VacancyProgressRing';
import type { Actions } from '../state/controller';
import { SessionContext, createStore } from '../state/store';
import type { SessionState } from '../state/types';
import { ALL_PRESETS, NETWORK_PRESETS, STATE_PRESETS, baseState, type GalleryPreset } from './presets';

const noopActions = new Proxy({} as Actions, {
  get: () => () => undefined,
});

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function PresetProvider({ state, children }: { state: SessionState; children: ReactNode }) {
  const [ctx] = useState(() => ({ store: createStore(state), actions: noopActions, preview: true }));
  return <SessionContext.Provider value={ctx}>{children}</SessionContext.Provider>;
}

function Thrower(): never {
  throw new Error('Проверка S25: ошибка отрисовки');
}

function PresetPage({ preset }: { preset: GalleryPreset }) {
  if (preset.special === 'boundary') {
    return (
      <PresetProvider state={{ ...baseState(), screen: 'question' }}>
        <AppFrame>
          <GlassPanel className="question-panel">
            <SectionBoundary name="Проверка S25">
              <Thrower />
            </SectionBoundary>
          </GlassPanel>
        </AppFrame>
      </PresetProvider>
    );
  }
  if (preset.special === 'n10') {
    return (
      <PresetProvider state={baseState()}>
        <AppFrame>
          <GlassPanel className="start-panel">
            <div className="start-panel__body" data-state-id="N10">
              <h1 className="start-panel__title">N10: приложение не загрузилось без сети</h1>
              <p className="start-panel__lead">
                Если страница не загрузилась без сети, браузер показывает свою ошибку. Управляемый интерфейс в этом случае недоступен.
              </p>
              <p className="start-panel__intro">
                Это известная граница: offline-first и PWA не входят в объём (docs/11-interface-states.md). Приложение не обещает работу без сети до первой загрузки.
              </p>
            </div>
          </GlassPanel>
        </AppFrame>
      </PresetProvider>
    );
  }
  return (
    <PresetProvider state={preset.build!()}>
      <AppView />
    </PresetProvider>
  );
}

interface RingExample {
  title: string;
  units: UnitId8;
  stage?: RingStage;
  active?: QuestionId;
  attention?: QuestionId[];
  level?: number;
  processing?: boolean;
  status?: string;
  detail?: string;
  note?: string;
  answered: number;
}

const RING_EXAMPLES: RingExample[] = [
  { title: '0%', units: [], answered: 0, status: 'Ответьте на четыре вопроса' },
  { title: '12.5% → 13%', units: ['q1.task1'], answered: 1 },
  { title: '25%', units: ['q1.task1', 'q1.task2'], answered: 1 },
  { title: '50%', units: ['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution'], answered: 2 },
  { title: 'Разреженное 50%: q2 и q4', units: ['q2.project', 'q2.contribution', 'q4.tools', 'q4.knowledge'], answered: 4 },
  { title: '75%: q3 пуст', units: ['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution', 'q4.tools', 'q4.knowledge'], answered: 4 },
  { title: '100%', units: [...UNIT_IDS], answered: 4, status: 'Данных по четырём вопросам достаточно' },
  { title: 'Запись q2, тишина', units: ['q1.task1', 'q1.task2'], stage: 'recording', active: 'q2', level: 0, answered: 1, status: 'Идёт запись · вопрос 2 из 4' },
  { title: 'Запись q2, голос', units: ['q1.task1', 'q1.task2'], stage: 'recording', active: 'q2', level: 0.8, answered: 1, status: 'Идёт запись · вопрос 2 из 4' },
  { title: 'Уточнение q2', units: ['q1.task1', 'q1.task2', 'q2.project'], stage: 'clarification', active: 'q2', attention: ['q2'], answered: 2, status: 'Вопрос 2 · нужно уточнение', detail: 'За какой результат в этом проекте отвечает сотрудник?' },
  { title: 'Запись q3 при уточнении q2', units: ['q1.task1', 'q1.task2', 'q2.project'], stage: 'recording', active: 'q3', attention: ['q2'], level: 0.8, answered: 2, status: 'Идёт запись · вопрос 3 из 4' },
  { title: 'Запись уточнения q2', units: ['q1.task1', 'q1.task2', 'q2.project'], stage: 'recording', active: 'q2', attention: ['q2'], level: 0.8, answered: 2, status: 'Записываем уточнение' },
  { title: 'Итог: три спокойных, q3 ждёт уточнения', units: ['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution', 'q3.direction', 'q4.tools', 'q4.knowledge'], stage: 'review', attention: ['q3'], answered: 4 },
  { title: 'Обработка: InlineLoading', units: ['q1.task1', 'q1.task2'], stage: 'processing', active: 'q2', processing: true, answered: 1 },
  { title: 'Снижение полноты', units: ['q2.project', 'q2.contribution', 'q4.tools', 'q4.knowledge'], note: 'Ответ изменён. Проверьте сведения ещё раз', answered: 3 },
];
type UnitId8 = (typeof UNIT_IDS)[number][];

function vec(units: UnitId8): boolean[] {
  return UNIT_IDS.map((u) => units.includes(u));
}

function RingStand({ reduced }: { reduced: boolean }) {
  return (
    <div className="gallery-grid">
      {RING_EXAMPLES.map((ex) => (
        <div key={ex.title} className="gallery-cell" data-testid={`ring-${ex.title}`}>
          <p className="gallery-cell__title">{ex.title}</p>
          <VacancyProgressRing
            validConfirmedUnits={vec(ex.units)}
            stage={ex.stage ?? 'review'}
            activeQuestionId={ex.active ?? 'q1'}
            answeredCount={ex.answered}
            connectionState="online"
            reducedMotion={reduced}
            attentionQuestionIds={ex.attention}
            audioLevel={ex.level}
            processing={ex.processing ? { key: 'gallery', label: 'Проверяем, хватает ли сведений' } : null}
            statusText={ex.status}
            statusDetail={ex.detail}
            note={ex.note}
            silent
          />
        </div>
      ))}
    </div>
  );
}

/** Интерактивный стенд: переходы, прерывание цели, запись по четвертям, уточнение, уровень голоса, reduced motion. */
function RingPlayground({ reduced }: { reduced: boolean }) {
  const [units, setUnits] = useState<boolean[]>(() => UNIT_IDS.map(() => false));
  const [stage, setStage] = useState<RingStage>('review');
  const [active, setActive] = useState<QuestionId>('q2');
  const [attention, setAttention] = useState<QuestionId[]>([]);
  const [level, setLevel] = useState(0.5);
  const [processing, setProcessing] = useState(false);
  const sequence: UnitId8[] = [
    [],
    ['q1.task1'],
    ['q1.task1', 'q1.task2'],
    ['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution'],
    [...UNIT_IDS],
  ];
  const run = (steps: UnitId8[], gap: number) => {
    steps.forEach((u, i) => window.setTimeout(() => setUnits(vec(u)), i * gap));
  };
  const n = QUESTION_IDS.indexOf(active) + 1;
  return (
    <div className="gallery-playground" data-testid="ring-playground">
      <div className="gallery-playground__ring">
        <VacancyProgressRing
          validConfirmedUnits={units}
          stage={processing ? 'processing' : stage}
          activeQuestionId={active}
          answeredCount={units.filter(Boolean).length > 0 ? 2 : 0}
          connectionState="online"
          reducedMotion={reduced}
          attentionQuestionIds={attention}
          audioLevel={level}
          processing={processing ? { key: String(processing), label: 'Составляем описание вакансии' } : null}
          statusText={stage === 'recording' ? `Идёт запись · вопрос ${n} из 4` : null}
        />
      </div>
      <div className="gallery-playground__controls">
        <fieldset className="gallery-fieldset">
          <legend>Подтверждённые единицы</legend>
          {UNIT_IDS.map((u, i) => (
            <Checkbox
              key={u}
              id={`pg-${u}`}
              labelText={`${u} — ${UNIT_LABELS[u]}`}
              checked={units[i]}
              onChange={(_, { checked }) => setUnits((prev) => prev.map((v, j) => (j === i ? checked : v)))}
            />
          ))}
        </fieldset>
        <fieldset className="gallery-fieldset">
          <legend>Нужно уточнение</legend>
          {QUESTION_IDS.map((q) => (
            <Checkbox
              key={q}
              id={`pg-attention-${q}`}
              labelText={`Вопрос ${QUESTION_IDS.indexOf(q) + 1}`}
              checked={attention.includes(q)}
              onChange={(_, { checked }) => setAttention((prev) => (checked ? [...prev, q] : prev.filter((x) => x !== q)))}
            />
          ))}
        </fieldset>
        <div className="answer-actions">
          <Button size="sm" kind="secondary" data-testid="pg-sequence" onClick={() => run(sequence, 700)}>
            0 → 12.5 → 25 → 50 → 100
          </Button>
          <Button size="sm" kind="secondary" data-testid="pg-interrupt" onClick={() => run([[...UNIT_IDS], ['q2.project', 'q2.contribution', 'q4.tools', 'q4.knowledge']], 150)}>
            Сменить цель во время анимации
          </Button>
          <Button size="sm" kind="secondary" data-testid="pg-clear" onClick={() => setUnits(vec([]))}>
            Сбросить
          </Button>
        </div>
        <div className="answer-actions" role="group" aria-label="Четверть записи">
          {QUESTION_IDS.map((q) => (
            <Button key={q} size="sm" kind={active === q ? 'primary' : 'ghost'} data-testid={`pg-zone-${q}`} onClick={() => setActive(q)}>
              Вопрос {QUESTION_IDS.indexOf(q) + 1}
            </Button>
          ))}
        </div>
        <div className="answer-actions">
          <Button size="sm" kind={stage === 'recording' ? 'primary' : 'tertiary'} renderIcon={Microphone} data-testid="pg-record" onClick={() => setStage(stage === 'recording' ? 'review' : 'recording')}>
            {stage === 'recording' ? 'Остановить запись' : 'Запись (лента и волны)'}
          </Button>
          <Button size="sm" kind={processing ? 'primary' : 'tertiary'} onClick={() => setProcessing((p) => !p)}>
            {processing ? 'Завершить ожидание' : 'Ожидание (InlineLoading)'}
          </Button>
        </div>
        <label className="gallery-range">
          Уровень голоса (только галерея): {level.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
      </div>
    </div>
  );
}

function ComponentsStand() {
  const [modal, setModal] = useState(false);
  return (
    <div className="gallery-components">
      <h3>Кнопки</h3>
      <div className="answer-actions">
        <Button kind="primary" size="lg" renderIcon={Microphone}>
          Записать ответ
        </Button>
        <Button kind="secondary" size="lg">Secondary</Button>
        <Button kind="tertiary" size="lg">Tertiary</Button>
        <Button kind="ghost" size="lg">Ghost</Button>
        <Button kind="danger" size="lg">Danger</Button>
        <Button kind="primary" size="lg" disabled>
          Disabled
        </Button>
        <Button kind="ghost" size="lg" hasIconOnly renderIcon={Add} iconDescription="Добавить" tooltipPosition="bottom" />
      </div>
      <h3>Поля</h3>
      <div className="gallery-fields">
        <TextInput id="g-ti" labelText="Заголовок" defaultValue="Описание вакансии" />
        <TextArea id="g-ta" labelText="Ваш ответ" defaultValue="Проверяет счета поставщиков." helperText="28 / 4000" rows={3} />
        <TextArea id="g-ta-inv" labelText="Слишком длинный ответ" defaultValue="…" invalid invalidText="Сократите ответ до 4000 символов. Сейчас 4250." rows={2} />
        <TextArea id="g-ta-dis" labelText="Недоступно во время обработки" defaultValue="Текст ответа" disabled rows={2} />
      </div>
      <h3>Уведомления</h3>
      <div className="gallery-notes">
        <InlineNotification kind="error" lowContrast hideCloseButton title="Не удалось обработать ответ" subtitle="Текст ответа сохранён." />
        <InlineNotification kind="warning" lowContrast hideCloseButton title="Нет связи с сервисом." subtitle="Ответы остаются в этой вкладке." />
        <InlineNotification kind="info" lowContrast hideCloseButton title="Обработка занимает больше времени." subtitle="Можно подождать или отменить." />
        <InlineNotification kind="success" lowContrast hideCloseButton title="Сведения подтверждены" />
        <ActionableNotification kind="info" lowContrast inline hasFocus={false} hideCloseButton title="Соединение могло восстановиться." subtitle="Повторите действие." actionButtonLabel="Повторить" />
        <ToastNotification kind="success" lowContrast title="Текст скопирован" timeout={0} hideCloseButton />
      </div>
      <h3>Метки, ожидание, источники</h3>
      <div className="answer-actions">
        <Tag type="purple">Демонстрация</Tag>
        <Tag type="green">Подтверждено</Tag>
        <Tag type="gray">Ждёт подтверждения</Tag>
        <Tag type="red">Противоречие</Tag>
        <Tag type="magenta">Изменено вручную</Tag>
        <InlineLoading status="active" description="Проверяем, хватает ли сведений" />
        <Tooltip label="Подсказка Carbon" align="bottom">
          <button type="button" className="mode-tag__info">?</button>
        </Tooltip>
      </div>
      <SkeletonText paragraph lineCount={3} />
      <Accordion>
        <AccordionItem title="Анализировать отказы оплаты.">«анализирует отказы оплаты» — ответ, версия 1</AccordionItem>
      </Accordion>
      <EmptyState stateId="S02" title="Ответ пока не добавлен">
        <p>Пустое состояние с действием.</p>
      </EmptyState>
      <Button kind="tertiary" onClick={() => setModal(true)}>
        Открыть Modal
      </Button>
      <Modal open={modal} modalHeading="Начать заново?" primaryButtonText="Удалить и начать заново" secondaryButtonText="Отмена" danger onRequestClose={() => setModal(false)} onRequestSubmit={() => setModal(false)} size="sm">
        <p>Ответы, факты, запись и описание будут удалены.</p>
      </Modal>
    </div>
  );
}

function GalleryIndex() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [opaque, setOpaque] = useState(() => window.location.hash.includes('opaque'));
  return (
    <div className="app-root" data-glass={opaque ? 'opaque' : undefined}>
      <div className="app-backdrop" aria-hidden="true" />
      <main className="app-main gallery">
        <GlassPanel className="gallery-panel">
          <h1 className="panel-title">Галерея состояний</h1>
          <p className="panel-lead">Только для разработки. Данные детерминированы, внешние сервисы не вызываются.</p>
          <div className="answer-actions">
            <Toggle id="g-reduced" labelText="Reduced motion (для круга)" toggled={reduced} onToggle={setReduced} size="sm" />
            <Toggle id="g-opaque" labelText="Непрозрачный fallback стекла" toggled={opaque} onToggle={setOpaque} size="sm" />
          </div>
          <nav className="gallery-nav" aria-label="Состояния">
            <h2>Состояния S01–S26</h2>
            <ul>
              {STATE_PRESETS.map((p) => (
                <li key={p.id}>
                  <a href={`#/gallery/state/${p.id}`}>
                    {p.id} — {p.title}
                  </a>
                </li>
              ))}
            </ul>
            <h2>Сеть N01–N10</h2>
            <ul>
              {NETWORK_PRESETS.map((p) => (
                <li key={p.id}>
                  <a href={`#/gallery/state/${p.id}`}>
                    {p.id} — {p.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </GlassPanel>
        <GlassPanel className="gallery-panel">
          <h2 className="side-panel__title">Круг: статичные состояния (MOT07)</h2>
          <RingStand reduced={reduced} />
        </GlassPanel>
        <GlassPanel className="gallery-panel">
          <h2 className="side-panel__title">Круг: интерактивный стенд (MOT03–MOT06, MOT09)</h2>
          <RingPlayground reduced={reduced} />
        </GlassPanel>
        <GlassPanel className="gallery-panel">
          <h2 className="side-panel__title">Компоненты Carbon в стеклянной панели</h2>
          <ComponentsStand />
        </GlassPanel>
      </main>
    </div>
  );
}

export default function Gallery() {
  const hash = useHash();
  useEffect(() => {
    document.body.setAttribute('data-gallery', 'true');
  }, []);
  const preset = useMemo(() => {
    const m = hash.match(/#\/gallery\/state\/([A-Z]\d{2})/);
    return m ? ALL_PRESETS.find((p) => p.id === m[1]) : undefined;
  }, [hash]);
  if (preset) {
    return (
      <div data-gallery-state={preset.id} data-glass={hash.includes('opaque') ? 'opaque' : undefined}>
        <PresetPage key={preset.id} preset={preset} />
        <a className="gallery-back" href="#/gallery">
          ← Галерея
        </a>
      </div>
    );
  }
  return <GalleryIndex />;
}
