/**
 * VacancyProgressRing — световое кольцо голосового брифа
 * (docs/12-progress-animation.md, редакция движения 2.0).
 *
 * Раздельные источники состояния каждой четверти (MOT09):
 *  1) validConfirmedUnits → чёткие дуги полноты в SVG (8 единиц по 45°);
 *  2) attentionQuestionIds → результат последней актуальной проверки (тёплая пульсация);
 *  3) stage + activeQuestionId + audioMeter → текущая запись (лента и волны на canvas).
 * Ожидание обработки — подпись этапа и один Carbon InlineLoading под кругом.
 * Время, громкость, сеть и ожидание на процент не влияют.
 */
import { InlineLoading } from '@carbon/react';
import { CheckmarkFilled, Time } from '@carbon/icons-react';
import { useEffect, useId, useRef, useState } from 'react';
import { UNIT_IDS, type QuestionId } from '../../../shared/constants';
import { completenessFromVector, displayPercent } from '../../../shared/completeness';
import type { AudioMeter } from '../../audio/level';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import {
  RING_GEOMETRY as G,
  UNIT_ARC_LENGTH,
  ZONE_QUESTIONS,
  polar,
  revealDashOffset,
  unitAngles,
  unitArcPath,
  zoneArcPath,
} from './geometry';
import { LightRingRenderer } from './lightRenderer';

export type RingStage =
  | 'start'
  | 'ready'
  | 'permission'
  | 'recording'
  | 'processing'
  | 'review'
  | 'clarification'
  | 'error'
  | 'result';

export interface RingProcessing {
  /** Ключ операции (requestId): задержка 150 мс считается заново для каждой операции. */
  key: string;
  label: string;
}

export interface VacancyProgressRingProps {
  validConfirmedUnits: readonly boolean[];
  stage: RingStage;
  /** Четверть текущего вопроса: в ней идёт запись и ожидание результата. */
  activeQuestionId: QuestionId | null;
  answeredCount: number;
  connectionState: 'online' | 'offline';
  reducedMotion: boolean;
  /**
   * Вопросы, для которых последняя актуальная проверка требует уточнения.
   * Предупреждение сохраняется при переходе к другому вопросу.
   */
  attentionQuestionIds?: readonly QuestionId[];
  /** Источник уровня реального микрофона (live/запись). */
  audioMeter?: AudioMeter | null;
  /** Статичный уровень 0…1 — только для галереи. */
  audioLevel?: number;
  processing?: RingProcessing | null;
  /** Текст состояния под кругом (например, «Проверьте сведения»). */
  statusText?: string | null;
  /** Уточняющая строка под состоянием (например, конкретный вопрос уточнения). */
  statusDetail?: string | null;
  /** Причина снижения полноты. */
  note?: string | null;
  /** Отключить объявления aria-live (галерея с несколькими кругами). */
  silent?: boolean;
  className?: string;
}

type Direction = 'up' | 'down' | 'none';

/** Глубокие оттенки чётких дуг на границах единиц: 0°, 45°, …, 360°. Контраст на стекле ≥ 3:1. */
const UNIT_STOPS = ['#6040F0', '#5048F2', '#3156F6', '#1A60FF', '#0E86D0', '#08919F', '#1C7FE0', '#3D5FF0', '#6040F0'] as const;

function sameVector(a: readonly boolean[], b: readonly boolean[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function useDelayedKey(key: string | null, delayMs: number): string | null {
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    const timer = window.setTimeout(() => setReadyKey(key), delayMs);
    return () => window.clearTimeout(timer);
  }, [key, delayMs]);
  return key && readyKey === key ? key : null;
}

function questionNumbers(ids: readonly QuestionId[]): string {
  const n = ids.map((q) => ZONE_QUESTIONS.indexOf(q) + 1);
  if (n.length === 1) return `вопрос ${n[0]}`;
  return `вопросы ${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}`;
}

export function VacancyProgressRing(props: VacancyProgressRingProps) {
  const {
    validConfirmedUnits,
    stage,
    activeQuestionId,
    answeredCount,
    connectionState,
    reducedMotion,
    attentionQuestionIds,
    audioMeter,
    audioLevel,
    processing,
    statusText,
    statusDetail,
    note,
    silent,
    className,
  } = props;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const vector = UNIT_IDS.map((_, i) => Boolean(validConfirmedUnits[i]));
  const exact = completenessFromVector(vector);
  const percent = displayPercent(exact);
  const confirmedCount = vector.filter(Boolean).length;
  const complete = confirmedCount === UNIT_IDS.length;
  const visible = useDocumentVisible();

  const attention = ZONE_QUESTIONS.filter((q) => attentionQuestionIds?.includes(q));
  const attentionKey = attention.join(' ');
  const activeZone = activeQuestionId ? ZONE_QUESTIONS.indexOf(activeQuestionId) : -1;
  const recording = stage === 'recording';
  const recordingZone = recording && activeZone >= 0 ? activeZone : null;
  const busyZone = stage === 'processing' && activeZone >= 0 ? activeZone : null;
  const zoneComplete = [0, 1, 2, 3].map((z) => vector[2 * z]! && vector[2 * z + 1]!);
  const zoneCompleteKey = zoneComplete.map(Number).join('');

  // Производное состояние: направление перехода каждой единицы и объявления.
  const [prevVector, setPrevVector] = useState<boolean[]>(vector);
  const [directions, setDirections] = useState<Direction[]>(() => vector.map(() => 'none'));
  const [announcement, setAnnouncement] = useState('');
  const [prevAttention, setPrevAttention] = useState(attentionKey);
  // Знак 100%: «first» — первое достижение в этом экземпляре (с задержкой после заполнения),
  // «instant» — уже было или показано при монтировании.
  const [successMode, setSuccessMode] = useState<'instant' | 'first'>('instant');
  const [everCompleted, setEverCompleted] = useState(complete);
  const [completionQuestion, setCompletionQuestion] = useState<QuestionId | null>(activeQuestionId);
  if (!sameVector(prevVector, vector)) {
    setPrevVector(vector);
    setDirections(vector.map((v, i) => (v === prevVector[i] ? directions[i]! : v ? 'up' : 'down')));
    setAnnouncement(`Прогресс ${percent}%`);
    if (complete && !everCompleted) {
      setEverCompleted(true);
      setSuccessMode('first');
      setCompletionQuestion(activeQuestionId);
    } else if (!complete) {
      setSuccessMode('instant');
    }
  } else if (prevAttention !== attentionKey) {
    setPrevAttention(attentionKey);
    const before = prevAttention ? prevAttention.split(' ') : [];
    const added = attention.filter((q) => !before.includes(q));
    if (added.length > 0) setAnnouncement(`Нужно уточнение: ${questionNumbers(added)}`);
  }
  // Переход к другому вопросу отменяет декоративное завершение.
  const successAnimated = successMode === 'first' && completionQuestion === activeQuestionId && !reducedMotion;

  // ---------- световой слой (canvas) ----------
  const figureRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LightRingRenderer | null>(null);

  useEffect(() => {
    const renderer = LightRingRenderer.create(canvasRef.current);
    rendererRef.current = renderer;
    const figure = figureRef.current;
    let observer: ResizeObserver | null = null;
    if (renderer && figure) {
      renderer.resize(figure.getBoundingClientRect().width || G.viewBox);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver((entries) => {
          const w = entries[0]?.contentRect.width;
          if (w) renderer.resize(w);
        });
        observer.observe(figure);
      }
    }
    return () => {
      observer?.disconnect();
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setState({
      zoneComplete: zoneCompleteKey.split('').map((c) => c === '1'),
      zoneAttention: ZONE_QUESTIONS.map((q) => attentionKey.split(' ').includes(q)),
      recordingZone,
      busyZone,
      reducedMotion,
    });
  }, [zoneCompleteKey, attentionKey, recordingZone, busyZone, reducedMotion]);

  // Круг вне экрана (прокрутка, галерея) тоже не тратит кадры.
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = figureRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1]?.isIntersecting ?? true), { rootMargin: '48px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Цикл анимации останавливается в скрытой вкладке, вне экрана и при reduced motion.
  const motionState = reducedMotion ? 'static' : visible && inView ? 'running' : 'paused';
  useEffect(() => {
    rendererRef.current?.setRunning(motionState === 'running');
  }, [motionState]);

  // Уровень голоса: подписка на реальный сигнал без перерисовки React.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!recording || reducedMotion || !audioMeter || !visible) return undefined;
    const unsubscribe = audioMeter.subscribe((level) => renderer?.setLevel(level));
    return () => {
      unsubscribe();
    };
  }, [recording, reducedMotion, audioMeter, visible]);

  useEffect(() => {
    if (audioMeter || audioLevel === undefined) return;
    rendererRef.current?.setLevel(audioLevel);
  }, [audioMeter, audioLevel]);

  const loadingKey = useDelayedKey(processing?.key ?? null, 150);
  const showLoading = Boolean(processing && loadingKey === processing.key);

  // Подпись по вопросам дублирует цвет и движение.
  const attentionOther = stage === 'clarification' && activeQuestionId ? attention.filter((q) => q !== activeQuestionId) : attention;
  const attentionText = attentionOther.length > 0 ? `Нужно уточнение: ${questionNumbers(attentionOther)}` : null;
  const valueText =
    `Подтверждено ${confirmedCount} из 8 частей; полнота ${percent} процента` +
    (attention.length > 0 ? `; нужно уточнение: ${questionNumbers(attention)}` : '');

  return (
    <div
      className={['vpr', className].filter(Boolean).join(' ')}
      data-stage={stage}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-paused={visible ? 'false' : 'true'}
      data-motion={motionState}
      data-connection={connectionState}
      data-percent={exact}
      data-recording-zone={recordingZone !== null ? ZONE_QUESTIONS[recordingZone] : ''}
      data-attention={attentionKey}
    >
      <div
        ref={figureRef}
        className="vpr__figure"
        role="progressbar"
        aria-label="Прогресс заполнения требований к вакансии"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={exact}
        aria-valuetext={valueText}
      >
        <canvas ref={canvasRef} className="vpr__light" aria-hidden="true" />
        <span className="vpr__backdrop" aria-hidden="true" />
        <svg className="vpr__svg" viewBox={`0 0 ${G.viewBox} ${G.viewBox}`} aria-hidden="true" focusable="false">
          <defs>
            {vector.map((_, unit) => {
              const { start, end } = unitAngles(unit);
              const a = polar(G.radius, start);
              const b = polar(G.radius, end);
              return (
                <linearGradient key={unit} id={`${uid}-g${unit}`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                  <stop offset="0" stopColor={UNIT_STOPS[unit]} />
                  <stop offset="1" stopColor={UNIT_STOPS[unit + 1]} />
                </linearGradient>
              );
            })}
          </defs>
          {/* Смысловые четверти: фиксированные положения q1–q4 и их состояние (для проверки и forced colors). */}
          <g className="vpr__zones">
            {ZONE_QUESTIONS.map((q, z) => (
              <path
                key={q}
                className="vpr__zone"
                d={zoneArcPath(z)}
                data-question={q}
                data-attention={attention.includes(q) ? 'true' : 'false'}
                data-recording={recordingZone === z ? 'true' : 'false'}
                data-complete={zoneComplete[z] ? 'true' : 'false'}
                fill="none"
                strokeWidth={G.rimWidth}
              />
            ))}
          </g>
          {/* Верхний слой: чёткая дуга подтверждённой полноты. */}
          {vector.map((on, unit) => {
            const dash = {
              strokeDasharray: `${UNIT_ARC_LENGTH} ${UNIT_ARC_LENGTH * 2}`,
              strokeDashoffset: revealDashOffset(on ? 1 : 0),
            };
            return (
              <g key={unit} className="vpr__unit" data-unit={UNIT_IDS[unit]} data-filled={on ? 'true' : 'false'}>
                <path
                  className="vpr__unit-glow vpr__unit-dash"
                  data-dir={directions[unit]}
                  d={unitArcPath(unit)}
                  fill="none"
                  stroke={`url(#${uid}-g${unit})`}
                  strokeWidth={G.unitGlowWidth}
                  strokeLinecap="butt"
                  style={dash}
                />
                <path
                  className="vpr__unit-arc vpr__unit-dash"
                  data-dir={directions[unit]}
                  d={unitArcPath(unit)}
                  fill="none"
                  stroke={`url(#${uid}-g${unit})`}
                  strokeWidth={G.unitWidth}
                  strokeLinecap="butt"
                  style={dash}
                />
              </g>
            );
          })}
        </svg>
        <div className="vpr__center" aria-hidden="true">
          <span
            className="vpr__success"
            data-visible={complete ? 'true' : 'false'}
            data-animate={successAnimated ? 'true' : 'false'}
          >
            <CheckmarkFilled size={20} aria-hidden="true" />
          </span>
          <span className="vpr__value">{percent}%</span>
          <span className="vpr__label">Прогресс {answeredCount} из 4</span>
        </div>
      </div>
      <div className="vpr__caption">
        <div className="vpr__stage" aria-live="polite">
          {processing ? (
            reducedMotion ? (
              <span className="vpr__static-wait" key={processing.label}>
                <Time size={16} aria-hidden="true" />
                <span>{processing.label}</span>
              </span>
            ) : showLoading ? (
              <InlineLoading key={processing.label} status="active" description={processing.label} />
            ) : (
              <span className="vpr__stage-text" key={processing.label}>
                {processing.label}
              </span>
            )
          ) : statusText && stage !== 'start' ? (
            <span className="vpr__stage-text" key={statusText} data-tone={stage === 'clarification' ? 'warm' : undefined}>
              {statusText}
            </span>
          ) : null}
        </div>
        {statusDetail && !processing ? <p className="vpr__detail">{statusDetail}</p> : null}
        {attentionText ? (
          <p className="vpr__attention" data-testid="ring-attention">
            <span className="vpr__attention-dot" aria-hidden="true" />
            {attentionText}
          </p>
        ) : null}
        {note ? <p className="vpr__note">{note}</p> : null}
      </div>
      {silent ? null : (
        <span className="cds--visually-hidden" aria-live="polite">
          {announcement}
        </span>
      )}
    </div>
  );
}
