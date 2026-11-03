/**
 * VacancyProgressRing — круг полноты по референсу Face ID (docs/12-progress-animation.md).
 * Три независимых источника состояния:
 *  1) validConfirmedUnits → 64 штриха в 8 группах (подтверждённая полнота);
 *  2) audioMeter / audioLevel → внешний ореол (только запись);
 *  3) processing → один Carbon InlineLoading под кругом (ожидание).
 * Время, громкость и сетевые события на заполнение не влияют.
 */
import { InlineLoading } from '@carbon/react';
import { CheckmarkFilled, Time } from '@carbon/icons-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { UNIT_IDS, type QuestionId } from '../../../shared/constants';
import { completenessFromVector, displayPercent } from '../../../shared/completeness';
import type { AudioMeter } from '../../audio/level';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import {
  GROUP_ARC_LENGTH,
  RING_GEOMETRY as G,
  STROKES,
  groupArcPath,
  haloTransform,
  revealDashOffset,
} from './geometry';

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
  activeQuestionId: QuestionId | null;
  answeredCount: number;
  connectionState: 'online' | 'offline';
  reducedMotion: boolean;
  /** Источник уровня реального микрофона (live/запись). */
  audioMeter?: AudioMeter | null;
  /** Статичный уровень 0…1 — только для галереи. */
  audioLevel?: number;
  processing?: RingProcessing | null;
  /** Текст состояния под кругом (например, «Проверьте сведения»). */
  statusText?: string | null;
  /** Причина снижения полноты. */
  note?: string | null;
  /** Отключить объявления aria-live (галерея с несколькими кругами). */
  silent?: boolean;
  className?: string;
}

type Direction = 'up' | 'down' | 'none';

const SECTOR_QUESTION: QuestionId[] = ['q1', 'q2', 'q3', 'q4'];

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

export function VacancyProgressRing(props: VacancyProgressRingProps) {
  const {
    validConfirmedUnits,
    stage,
    activeQuestionId,
    answeredCount,
    connectionState,
    reducedMotion,
    audioMeter,
    audioLevel,
    processing,
    statusText,
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

  // Производное состояние: направление перехода каждой группы и объявление.
  const [prevVector, setPrevVector] = useState<boolean[]>(vector);
  const [directions, setDirections] = useState<Direction[]>(() => vector.map(() => 'none'));
  const [announcement, setAnnouncement] = useState('');
  // Знак 100%: «first» — первое достижение в этом экземпляре (с задержкой после заполнения),
  // «instant» — уже было или показано при монтировании.
  const [successMode, setSuccessMode] = useState<'instant' | 'first'>('instant');
  const [everCompleted, setEverCompleted] = useState(complete);
  const [completionQuestion, setCompletionQuestion] = useState<QuestionId | null>(activeQuestionId);
  if (!sameVector(prevVector, vector)) {
    setPrevVector(vector);
    setDirections(vector.map((v, i) => (v === prevVector[i] ? directions[i]! : v ? 'up' : 'down')));
    setAnnouncement(`Полнота ${percent}%`);
    if (complete && !everCompleted) {
      setEverCompleted(true);
      setSuccessMode('first');
      setCompletionQuestion(activeQuestionId);
    } else if (!complete) {
      setSuccessMode('instant');
    }
  }
  // Переход к другому вопросу отменяет декоративное завершение.
  const successAnimated = successMode === 'first' && completionQuestion === activeQuestionId && !reducedMotion;

  // Ореол: подписка на реальный сигнал без перерисовки React.
  const haloRef = useRef<SVGCircleElement>(null);
  const recording = stage === 'recording';
  useEffect(() => {
    const el = haloRef.current;
    if (!el || !recording || reducedMotion || !audioMeter || !visible) return undefined;
    const unsubscribe = audioMeter.subscribe((level) => {
      const t = haloTransform(level);
      el.style.transform = `scale(${t.scale})`;
      el.style.opacity = String(t.opacity);
    });
    return () => {
      unsubscribe();
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
    };
  }, [recording, reducedMotion, audioMeter, visible]);

  const staticHalo: CSSProperties | undefined =
    recording && audioLevel !== undefined && !audioMeter
      ? reducedMotion
        ? { opacity: 0.5 }
        : { transform: `scale(${haloTransform(audioLevel).scale})`, opacity: haloTransform(audioLevel).opacity }
      : recording && reducedMotion
        ? { opacity: 0.5 }
        : undefined;

  const loadingKey = useDelayedKey(processing?.key ?? null, 150);
  const showLoading = Boolean(processing && loadingKey === processing.key);
  const activeSector = activeQuestionId ? SECTOR_QUESTION.indexOf(activeQuestionId) : -1;

  return (
    <div
      className={['vpr', className].filter(Boolean).join(' ')}
      data-stage={stage}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-paused={visible ? 'false' : 'true'}
      data-connection={connectionState}
      data-percent={exact}
    >
      <div
        className="vpr__figure"
        role="progressbar"
        aria-label="Полнота требований к вакансии"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={exact}
        aria-valuetext={`Подтверждено ${confirmedCount} из 8 частей; полнота ${percent} процента`}
      >
        <svg className="vpr__svg" viewBox={`0 0 ${G.viewBox} ${G.viewBox}`} aria-hidden="true" focusable="false">
          <defs>
            {vector.map((on, group) => (
              <mask key={group} id={`${uid}-m${group}`} maskUnits="userSpaceOnUse" x="0" y="0" width={G.viewBox} height={G.viewBox}>
                <path
                  className="vpr__mask-arc"
                  data-dir={directions[group]}
                  d={groupArcPath(group)}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={G.maskWidth}
                  strokeLinecap="butt"
                  style={{
                    strokeDasharray: `${GROUP_ARC_LENGTH} ${GROUP_ARC_LENGTH * 2}`,
                    strokeDashoffset: revealDashOffset(on ? 1 : 0),
                  }}
                />
              </mask>
            ))}
          </defs>
          <g className="vpr__track">
            {STROKES.map((s) => (
              <line
                key={s.index}
                className={s.sector === activeSector ? 'vpr__tick vpr__tick--active-sector' : 'vpr__tick'}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                strokeWidth={G.strokeWidth}
                strokeLinecap="round"
              />
            ))}
          </g>
          {vector.map((on, group) => (
            <g key={group} className="vpr__group" mask={`url(#${uid}-m${group})`} data-unit={UNIT_IDS[group]} data-filled={on ? 'true' : 'false'}>
              {STROKES.filter((s) => s.group === group).map((s) => (
                <line
                  key={s.index}
                  className="vpr__fill"
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  strokeWidth={G.strokeWidth}
                  strokeLinecap="round"
                />
              ))}
            </g>
          ))}
          <g className="vpr__halo-wrap" data-active={recording ? 'true' : 'false'}>
            <circle
              ref={haloRef}
              className="vpr__halo"
              cx={G.center}
              cy={G.center}
              r={G.haloRadius}
              fill="none"
              strokeWidth={G.haloWidth}
              style={staticHalo}
            />
          </g>
        </svg>
        <div className="vpr__center" aria-hidden="true">
          <span
            className="vpr__success"
            data-visible={complete ? 'true' : 'false'}
            data-animate={successAnimated ? 'true' : 'false'}
          >
            <CheckmarkFilled size={20} aria-hidden="true" />
          </span>
          <span className="vpr__label">Полнота</span>
          <span className="vpr__value">{percent}%</span>
        </div>
      </div>
      <div className="vpr__caption">
        <p className="vpr__answered">Проверено ответов: {answeredCount} из 4</p>
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
          ) : statusText ? (
            <span className="vpr__stage-text" key={statusText}>
              {statusText}
            </span>
          ) : null}
        </div>
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
