/**
 * Геометрия и чистые функции движения VacancyProgressRing
 * (docs/12-progress-animation.md, редакция движения 2.0: MOT02–MOT06).
 *
 * Углы — в градусах от 12 часов по часовой стрелке. Для SVG и canvas
 * переводятся в радианы от 3 часов (ось y экрана направлена вниз).
 * Время — в миллисекундах.
 */
import type { QuestionId } from '../../../shared/constants';

export const RING_GEOMETRY = {
  viewBox: 220,
  center: 110,
  /** Радиус светового обода и чётких дуг полноты. */
  radius: 96,
  /** Обод в покое: 2–3 px. */
  rimWidth: 2.5,
  /** Лента записи: 10–14 px. */
  bandWidth: 12,
  /** Чёткая дуга подтверждённой полноты и её мягкое свечение. */
  unitWidth: 3.5,
  unitGlowWidth: 9,
  /** Запас вокруг viewBox для светового слоя: мягкий свет может выходить за край. */
  lightBleed: 40,
  zones: 4,
  unitsPerZone: 2,
  units: 8,
  zoneSweep: 90,
  unitSweep: 45,
} as const;

const G = RING_GEOMETRY;

/** Длительности и амплитуды движения (MOT03–MOT06). */
export const RING_MOTION = {
  /** Перетекание максимума яркости через четыре зоны: 6–8 s. */
  flowCycle: 7200,
  /** Колебание кромки по радиусу: 0,5–1 px за 1,4–2 s. */
  edgeAmplitude: 0.75,
  edgePeriods: [1500, 1760, 1920, 1640] as readonly number[],
  /** Расширение ленты записи: 220–300 ms. */
  bandIn: 260,
  bandOut: 240,
  /** Две волны вдоль дуги: первая за 1,2–1,8 s, вторая следом с меньшей амплитудой. */
  wavePeriod: 1500,
  waveLag: 0.38,
  secondWaveGain: 0.55,
  /** Отклонение кромки: тишина — минимум, голос — 2–4 px. */
  voiceMinAmplitude: 0.6,
  voiceMaxAmplitude: 3.8,
  /** Погасание голосовой волны после остановки: 180–250 ms. */
  voiceFade: 220,
  /** Тёплая пульсация: 2,4 s, интенсивность 45–75 %. */
  pulsePeriod: 2400,
  pulseMin: 0.45,
  pulseMax: 0.75,
  /** Переход холодный ↔ тёплый цвет четверти. */
  warmthTransition: 400,
  /** Приглушение остальных зон во время записи. */
  dimDuring: 0.5,
} as const;

export const ZONE_QUESTIONS: readonly QuestionId[] = ['q1', 'q2', 'q3', 'q4'];

export function round(n: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Градусы от 12 часов по часовой → радианы для canvas/SVG (0 — 3 часа). */
export function toScreenRad(deg: number): number {
  return ((deg - 90) * Math.PI) / 180;
}

export function polar(radius: number, deg: number): { x: number; y: number } {
  const a = toScreenRad(deg);
  return { x: round(G.center + radius * Math.cos(a)), y: round(G.center + radius * Math.sin(a)) };
}

/** Четверть вопроса: q1 — 12→3 часа, q2 — 3→6, q3 — 6→9, q4 — 9→12. */
export function zoneAngles(zone: number): { start: number; end: number; mid: number } {
  const start = zone * G.zoneSweep;
  return { start, end: start + G.zoneSweep, mid: start + G.zoneSweep / 2 };
}

/** Единица полноты k = половина четверти: 45° и 12,5 % круга. */
export function unitAngles(unit: number): { start: number; end: number } {
  const start = unit * G.unitSweep;
  return { start, end: start + G.unitSweep };
}

/** Дуга по часовой стрелке. */
export function arcPath(startDeg: number, endDeg: number, radius: number = G.radius): string {
  const a = polar(radius, startDeg);
  const b = polar(radius, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
}

export function unitArcPath(unit: number): string {
  const { start, end } = unitAngles(unit);
  return arcPath(start, end);
}

export function zoneArcPath(zone: number): string {
  const { start, end } = zoneAngles(zone);
  return arcPath(start, end);
}

/** Длина дуги одной единицы (без pathLength — для совместимости Safari). */
export const UNIT_ARC_LENGTH = round((G.radius * G.unitSweep * Math.PI) / 180);

/** stroke-dashoffset для доли проявления 0…1: дуга растёт по часовой от начала единицы. */
export function revealDashOffset(reveal: number): number {
  return round(UNIT_ARC_LENGTH * (1 - clamp01(reveal)));
}

// ---------- движение ----------

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) ** 3;
}

/** Кратчайшее угловое расстояние в градусах, 0…180. */
export function angleDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/**
 * Вес поля зоны в точке обода: 1 внутри четверти и мягкий спад на ±overlap°
 * за её границами. Края соседних полей перекрываются.
 */
export function zoneWeight(zone: number, deg: number, overlap = 16): number {
  const mid = zoneAngles(zone).mid;
  const d = angleDistance(deg, mid);
  const half = G.zoneSweep / 2;
  return 1 - smoothstep(half - overlap, half + overlap, d);
}

/**
 * Базовый цикл: максимум яркости обходит четыре зоны за flowCycle
 * и возвращается к исходной фазе. lagMs сдвигает фазу (ядро и рассеянный свет).
 */
export function flowIntensity(zone: number, tMs: number, lagMs = 0): number {
  const phase = (((tMs - lagMs) % RING_MOTION.flowCycle) + RING_MOTION.flowCycle) % RING_MOTION.flowCycle;
  const peakDeg = (phase / RING_MOTION.flowCycle) * 360;
  const d = angleDistance(zoneAngles(zone).mid, peakDeg);
  const bump = ((Math.cos((d * Math.PI) / 180) + 1) / 2) ** 2;
  return 0.3 + 0.68 * bump;
}

/** Колебание кромки в зоне (px). Амплитуда edgeAmplitude, период 1,4–2 s. */
export function edgeOffset(zone: number, deg: number, tMs: number): number {
  const period = RING_MOTION.edgePeriods[zone % RING_MOTION.edgePeriods.length]!;
  return RING_MOTION.edgeAmplitude * Math.sin((2 * Math.PI * tMs) / period + zone * 1.7 + (deg * Math.PI) / 60);
}

/** Тёплая пульсация 45–75 % без полного погасания, период 2,4 s. */
export function pulseIntensity(tMs: number): number {
  const s = 0.5 - 0.5 * Math.cos((2 * Math.PI * tMs) / RING_MOTION.pulsePeriod);
  return RING_MOTION.pulseMin + (RING_MOTION.pulseMax - RING_MOTION.pulseMin) * s;
}

/** Уровень голоса 0…1 → амплитуда волны (px). Тишина — минимум, голос — до 3,8 px. */
export function voiceAmplitude(level: number): number {
  return round(RING_MOTION.voiceMinAmplitude + (RING_MOTION.voiceMaxAmplitude - RING_MOTION.voiceMinAmplitude) * clamp01(level));
}

/** Центры двух волн в долях четверти; волна входит и выходит за маску плавно. */
export function waveCenters(tMs: number): [number, number] {
  const p = (((tMs % RING_MOTION.wavePeriod) + RING_MOTION.wavePeriod) % RING_MOTION.wavePeriod) / RING_MOTION.wavePeriod;
  const first = -0.25 + 1.5 * p;
  return [first, first - RING_MOTION.waveLag];
}

/** Профиль волн вдоль ленты (u — доля четверти 0…1), в px при амплитуде amp. */
export function waveProfile(u: number, tMs: number, amp: number): number {
  const [c1, c2] = waveCenters(tMs);
  const g = (x: number) => Math.exp(-((x / 0.14) ** 2));
  const ripple = 0.16 * Math.sin(2 * Math.PI * (4 * u - tMs / 900));
  return amp * (g(u - c1) + RING_MOTION.secondWaveGain * g(u - c2) + ripple);
}

/** Сужение ленты у границ четверти: маска ограничивает волны зоной вопроса. */
export function bandTaper(u: number): number {
  return smoothstep(0, 0.06, u) * smoothstep(1, 0.94, u);
}
