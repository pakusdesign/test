/**
 * Геометрия VacancyProgressRing (docs/12-progress-animation.md, MOT02).
 * Углы в градусах: 0° — вправо, положительное направление — по часовой стрелке
 * (ось y SVG направлена вниз).
 */
export const RING_GEOMETRY = {
  viewBox: 220,
  center: 110,
  innerRadius: 88,
  outerRadius: 98,
  strokeWidth: 2,
  haloRadius: 104,
  haloWidth: 1.5,
  haloMaxScale: 1.03,
  sectorSweep: 84,
  sectorGap: 6,
  sectors: 4,
  strokesPerSector: 16,
  strokesPerGroup: 8,
  groups: 8,
  totalStrokes: 64,
  /** Радиус и ширина дуги маски: покрывают штрих 88–98 с круглыми концами. */
  maskRadius: 93,
  maskWidth: 16,
} as const;

const G = RING_GEOMETRY;

export function sectorStartAngle(sector: number): number {
  return -87 + 90 * sector;
}

export function strokeAngle(sector: number, index: number): number {
  return sectorStartAngle(sector) + ((index + 0.5) * G.sectorSweep) / G.strokesPerSector;
}

function polar(radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: round(G.center + radius * Math.cos(rad)), y: round(G.center + radius * Math.sin(rad)) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface StrokeLine {
  /** Индекс 0–63 по часовой стрелке от начала сектора q1. */
  index: number;
  sector: number;
  group: number;
  angle: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 64 радиальных штриха; группа k = индексы 8k…8k+7 = единица UNIT_IDS[k]. */
export const STROKES: readonly StrokeLine[] = Array.from({ length: G.totalStrokes }, (_, index) => {
  const sector = Math.floor(index / G.strokesPerSector);
  const local = index % G.strokesPerSector;
  const angle = strokeAngle(sector, local);
  const a = polar(G.innerRadius, angle);
  const b = polar(G.outerRadius, angle);
  return { index, sector, group: Math.floor(index / G.strokesPerGroup), angle, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
});

export function groupAngles(group: number): { start: number; end: number } {
  const sector = Math.floor(group / 2);
  const half = group % 2;
  const span = G.sectorSweep / 2;
  const start = sectorStartAngle(sector) + half * span;
  return { start, end: start + span };
}

/** Дуга маски группы, по часовой стрелке. */
export function groupArcPath(group: number): string {
  const { start, end } = groupAngles(group);
  const a = polar(G.maskRadius, start);
  const b = polar(G.maskRadius, end);
  return `M ${a.x} ${a.y} A ${G.maskRadius} ${G.maskRadius} 0 0 1 ${b.x} ${b.y}`;
}

/** Длина дуги маски (без pathLength — для совместимости Safari). */
export const GROUP_ARC_LENGTH = round((G.maskRadius * (G.sectorSweep / 2) * Math.PI) / 180);

/** stroke-dashoffset для доли проявления 0…1. */
export function revealDashOffset(reveal: number): number {
  const r = Math.min(1, Math.max(0, reveal));
  return round(GROUP_ARC_LENGTH * (1 - r));
}

/** Отображение уровня голоса на ореол (MOT05). */
export function haloTransform(level: number): { scale: number; opacity: number } {
  const l = Math.min(1, Math.max(0, level));
  return { scale: round(1 + 0.03 * l), opacity: round(0.2 + 0.3 * l) };
}
