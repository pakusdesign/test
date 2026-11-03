/**
 * Уровень голоса для ореола. Значения нормализации — стартовые; порог тишины
 * нужно проверить на реальном микрофоне (MOT05). Громкость не влияет на полноту.
 */
export const LEVEL_FLOOR_DB = -55;
export const LEVEL_CEIL_DB = -12;

export function rmsFromSamples(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function rmsToLevel(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - LEVEL_FLOOR_DB) / (LEVEL_CEIL_DB - LEVEL_FLOOR_DB)));
}

/**
 * Экспоненциальное сглаживание: attack при росте, release при спаде.
 * При большом интервале (вкладка была скрыта) возвращает цель сразу —
 * пропущенные кадры не проигрываются.
 */
export function smoothLevel(previous: number, target: number, dtMs: number, attackMs = 60, releaseMs = 180): number {
  if (dtMs <= 0) return previous;
  if (dtMs > 250) return target;
  const tau = target > previous ? attackMs : releaseMs;
  const alpha = 1 - Math.exp(-dtMs / tau);
  return previous + (target - previous) * alpha;
}

export type LevelListener = (level: number) => void;

/** Источник уровня для ореола: подписка без перерисовки React на каждом кадре. */
export interface AudioMeter {
  subscribe(listener: LevelListener): () => void;
  stop(): void;
}
