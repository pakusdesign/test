import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RING_GEOMETRY,
  RING_MOTION,
  UNIT_ARC_LENGTH,
  angleDistance,
  bandTaper,
  flowIntensity,
  polar,
  pulseIntensity,
  revealDashOffset,
  unitAngles,
  voiceAmplitude,
  waveCenters,
  waveProfile,
  zoneAngles,
  zoneWeight,
} from '../../src/client/components/ring/geometry';
import { rmsFromSamples, rmsToLevel, smoothLevel } from '../../src/client/audio/level';
import { APP_TOKENS, MOTION_MS, MOTION_TOKENS } from '../../src/client/styles/tokens';
import { mapGetUserMediaError, pickMimeType } from '../../src/client/audio/recorder';

describe('геометрия круга (MOT02, MOT06)', () => {
  it('четыре четверти по 90° по часовой: q1 12→3, q2 3→6, q3 6→9, q4 9→12', () => {
    expect([0, 1, 2, 3].map((z) => zoneAngles(z))).toEqual([
      { start: 0, end: 90, mid: 45 },
      { start: 90, end: 180, mid: 135 },
      { start: 180, end: 270, mid: 225 },
      { start: 270, end: 360, mid: 315 },
    ]);
    // 12 часов — вверху, 3 часа — справа, 6 — внизу.
    expect(polar(96, 0)).toEqual({ x: 110, y: 14 });
    expect(polar(96, 90)).toEqual({ x: 206, y: 110 });
    expect(polar(96, 180)).toEqual({ x: 110, y: 206 });
  });

  it('восемь единиц по 45°: две половины каждой четверти', () => {
    expect(unitAngles(0)).toEqual({ start: 0, end: 45 });
    expect(unitAngles(3)).toEqual({ start: 135, end: 180 });
    expect(unitAngles(7)).toEqual({ start: 315, end: 360 });
    expect(RING_GEOMETRY.units * RING_GEOMETRY.unitSweep).toBe(360);
  });

  it('обод 2–3 px, лента записи 10–14 px; свет помещается в запас холста', () => {
    expect(RING_GEOMETRY.rimWidth).toBeGreaterThanOrEqual(2);
    expect(RING_GEOMETRY.rimWidth).toBeLessThanOrEqual(3);
    expect(RING_GEOMETRY.bandWidth).toBeGreaterThanOrEqual(10);
    expect(RING_GEOMETRY.bandWidth).toBeLessThanOrEqual(14);
    const outer = RING_GEOMETRY.radius + RING_GEOMETRY.bandWidth / 2 + RING_MOTION.voiceMaxAmplitude;
    expect(outer).toBeLessThan(RING_GEOMETRY.center + RING_GEOMETRY.lightBleed);
  });

  it('dashoffset: 0 → длина дуги, 1 → 0', () => {
    expect(UNIT_ARC_LENGTH).toBeCloseTo((96 * Math.PI) / 4, 2);
    expect(revealDashOffset(0)).toBeCloseTo(UNIT_ARC_LENGTH);
    expect(revealDashOffset(1)).toBe(0);
    expect(revealDashOffset(2)).toBe(0);
  });

  it('поля перекрываются на стыках: сумма весов соседних зон = 1', () => {
    expect(zoneWeight(0, 45)).toBe(1);
    expect(zoneWeight(1, 45)).toBe(0);
    expect(zoneWeight(0, 90)).toBeCloseTo(0.5);
    expect(zoneWeight(1, 90)).toBeCloseTo(0.5);
    for (const deg of [80, 85, 95, 100, 352, 5]) {
      const sum = [0, 1, 2, 3].reduce((n, z) => n + zoneWeight(z, deg), 0);
      expect(sum).toBeCloseTo(1, 5);
    }
    expect(angleDistance(350, 10)).toBe(20);
  });
});

describe('движение (MOT03–MOT05)', () => {
  it('базовый цикл 6–8 s: максимум проходит соседние зоны и возвращается к исходной фазе', () => {
    expect(RING_MOTION.flowCycle).toBeGreaterThanOrEqual(6000);
    expect(RING_MOTION.flowCycle).toBeLessThanOrEqual(8000);
    const c = RING_MOTION.flowCycle;
    // В начале цикла ярче q4/q1 (максимум у 12 часов), через четверть цикла — q1/q2.
    expect(flowIntensity(0, c / 8)).toBeGreaterThan(flowIntensity(2, c / 8));
    expect(flowIntensity(1, (3 * c) / 8)).toBeGreaterThan(flowIntensity(3, (3 * c) / 8));
    // Стык конца цикла с началом.
    for (let z = 0; z < 4; z += 1) expect(flowIntensity(z, c)).toBeCloseTo(flowIntensity(z, 0), 6);
    // Поле не гаснет полностью.
    for (let t = 0; t < c; t += 250) expect(flowIntensity(2, t)).toBeGreaterThan(0.25);
  });

  it('кромка колеблется на 0,5–1 px с периодом 1,4–2 s', () => {
    expect(RING_MOTION.edgeAmplitude).toBeGreaterThanOrEqual(0.5);
    expect(RING_MOTION.edgeAmplitude).toBeLessThanOrEqual(1);
    for (const p of RING_MOTION.edgePeriods) {
      expect(p).toBeGreaterThanOrEqual(1400);
      expect(p).toBeLessThanOrEqual(2000);
    }
  });

  it('запись: расширение 220–300 ms, волна 1,2–1,8 s, погасание 180–250 ms', () => {
    expect(RING_MOTION.bandIn).toBeGreaterThanOrEqual(220);
    expect(RING_MOTION.bandIn).toBeLessThanOrEqual(300);
    expect(RING_MOTION.wavePeriod).toBeGreaterThanOrEqual(1200);
    expect(RING_MOTION.wavePeriod).toBeLessThanOrEqual(1800);
    expect(RING_MOTION.voiceFade).toBeGreaterThanOrEqual(180);
    expect(RING_MOTION.voiceFade).toBeLessThanOrEqual(250);
    // Вторая волна идёт следом за первой с меньшей амплитудой.
    const [c1, c2] = waveCenters(500);
    expect(c2).toBeLessThan(c1);
    expect(RING_MOTION.secondWaveGain).toBeLessThan(1);
  });

  it('амплитуда волны: тишина — минимум, голос — 2–4 px', () => {
    expect(voiceAmplitude(0)).toBeGreaterThan(0);
    expect(voiceAmplitude(0)).toBeLessThan(1);
    expect(voiceAmplitude(0.5)).toBeGreaterThanOrEqual(2);
    expect(voiceAmplitude(1)).toBeLessThanOrEqual(4);
    expect(voiceAmplitude(1)).toBeGreaterThan(voiceAmplitude(0.5));
    // Профиль ограничен амплитудой; маска четверти сужает ленту к границам.
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => waveProfile(i / 100, 400, 3)));
    expect(peak).toBeLessThanOrEqual(3 * 1.75);
    expect(bandTaper(0)).toBe(0);
    expect(bandTaper(1)).toBe(0);
    expect(bandTaper(0.5)).toBe(1);
  });

  it('тёплая пульсация: 2,4 s, 45–75 % без полного погасания', () => {
    expect(RING_MOTION.pulsePeriod).toBe(2400);
    const values = Array.from({ length: 49 }, (_, i) => pulseIntensity(i * 50));
    expect(Math.min(...values)).toBeCloseTo(0.45, 3);
    expect(Math.max(...values)).toBeCloseTo(0.75, 3);
    expect(pulseIntensity(2400)).toBeCloseTo(pulseIntensity(0), 6);
  });
});

describe('уровень голоса (MOT05)', () => {
  it('тишина = 0, громкий сигнал = 1', () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(0.0001)).toBe(0);
    expect(rmsToLevel(0.5)).toBe(1);
    expect(rmsFromSamples([0.5, -0.5])).toBeCloseTo(0.5);
  });

  it('attack быстрее release; большой разрыв времени — без проигрывания кадров', () => {
    const up = smoothLevel(0, 1, 16, 60, 180);
    const down = 1 - smoothLevel(1, 0, 16, 60, 180);
    expect(up).toBeGreaterThan(down);
    expect(smoothLevel(0.2, 0.9, 1000)).toBe(0.9);
  });
});

describe('запись: формат и ошибки', () => {
  it('предпочтение webm/opus, затем mp4', () => {
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType(() => false)).toBeUndefined();
  });

  it('ошибки getUserMedia сопоставлены состояниям', () => {
    const e = (name: string) => Object.assign(new Error(name), { name });
    expect(mapGetUserMediaError(e('NotAllowedError'))).toBe('permission_denied');
    expect(mapGetUserMediaError(e('NotFoundError'))).toBe('no_device');
    expect(mapGetUserMediaError(e('NotReadableError'))).toBe('device_busy');
  });
});

describe('токены (DES03, MOT)', () => {
  const scss = readFileSync('src/client/styles/_tokens.scss', 'utf8');
  it('значения SCSS совпадают с tokens.ts', () => {
    for (const [name, value] of Object.entries({ ...APP_TOKENS, ...MOTION_TOKENS })) {
      expect(scss).toContain(`--${name}: ${value};`);
    }
  });

  it('длительности и кривая по спецификации', () => {
    expect(MOTION_TOKENS['motion-fill-duration']).toBe('400ms');
    expect(MOTION_TOKENS['motion-drain-duration']).toBe('240ms');
    expect(MOTION_TOKENS['motion-fill-easing']).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(MOTION_MS).toMatchObject({ fill: 400, drain: 240, haloFade: 120, successFade: 180, question: 180, loadingDelay: 150 });
  });

  it('CSS круга использует токены, без transition: all', () => {
    const ring = readFileSync('src/client/styles/_ring.scss', 'utf8');
    expect(ring).not.toMatch(/^\s+transition:\s*all/m);
    expect(ring).toContain('var(--motion-fill-duration)');
    expect(ring).toContain('var(--motion-drain-duration)');
  });
});
