import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GROUP_ARC_LENGTH,
  RING_GEOMETRY,
  STROKES,
  groupAngles,
  haloTransform,
  revealDashOffset,
  sectorStartAngle,
  strokeAngle,
} from '../../src/client/components/ring/geometry';
import { rmsFromSamples, rmsToLevel, smoothLevel } from '../../src/client/audio/level';
import { APP_TOKENS, MOTION_MS, MOTION_TOKENS } from '../../src/client/styles/tokens';
import { mapGetUserMediaError, pickMimeType } from '../../src/client/audio/recorder';

describe('геометрия круга (MOT02)', () => {
  it('64 штриха, 4 сектора по 16, 8 групп по 8', () => {
    expect(STROKES).toHaveLength(64);
    for (let g = 0; g < 8; g += 1) expect(STROKES.filter((s) => s.group === g)).toHaveLength(8);
    for (let q = 0; q < 4; q += 1) expect(STROKES.filter((s) => s.sector === q)).toHaveLength(16);
  });

  it('сектор q начинается с −87° + 90°×q, штрих j — start + (j+0.5)×84/16', () => {
    expect(sectorStartAngle(0)).toBe(-87);
    expect(sectorStartAngle(3)).toBe(183);
    expect(strokeAngle(0, 0)).toBeCloseTo(-87 + 0.5 * 5.25);
    expect(strokeAngle(1, 15)).toBeCloseTo(3 + 15.5 * 5.25);
  });

  it('штрих — радиальная линия от r=88 до r=98', () => {
    const s = STROKES[0]!;
    const r1 = Math.hypot(s.x1 - 110, s.y1 - 110);
    const r2 = Math.hypot(s.x2 - 110, s.y2 - 110);
    expect(r1).toBeCloseTo(88, 2);
    expect(r2).toBeCloseTo(98, 2);
  });

  it('первый сектор сверху, по часовой: q1 сверху справа, q2 справа снизу', () => {
    const q1 = STROKES.filter((s) => s.sector === 0);
    expect(q1[0]!.y2).toBeLessThan(110 - 90); // почти вверху
    const q2 = STROKES.filter((s) => s.sector === 1);
    expect(q2[0]!.x2).toBeGreaterThan(200); // справа
  });

  it('группа покрывает половину сектора: 42°; между секторами 6°', () => {
    expect(groupAngles(0)).toEqual({ start: -87, end: -45 });
    expect(groupAngles(1)).toEqual({ start: -45, end: -3 });
    expect(groupAngles(2).start - groupAngles(1).end).toBe(6);
  });

  it('dashoffset: 0 → длина дуги, 1 → 0', () => {
    expect(revealDashOffset(0)).toBeCloseTo(GROUP_ARC_LENGTH);
    expect(revealDashOffset(1)).toBe(0);
    expect(revealDashOffset(2)).toBe(0);
  });

  it('ореол: scale = 1 + 0.03×level, opacity = 0.2 + 0.3×level', () => {
    expect(haloTransform(0)).toEqual({ scale: 1, opacity: 0.2 });
    expect(haloTransform(1)).toEqual({ scale: 1.03, opacity: 0.5 });
    expect(haloTransform(0.5)).toEqual({ scale: 1.015, opacity: 0.35 });
    expect(RING_GEOMETRY.haloRadius * RING_GEOMETRY.haloMaxScale).toBeLessThan(110);
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
