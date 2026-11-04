/**
 * Декоративный световой слой VacancyProgressRing (docs/12-progress-animation.md, MOT01–MOT05, MOT11).
 *
 * Рисует на canvas три вещи: четыре размытых световых поля (заранее размытые
 * спрайты — меняются только поворот и прозрачность), непрерывный обод 2–3 px
 * и ленту записи с двумя волнами. Чёткая дуга полноты живёт в SVG поверх
 * и от этого слоя не зависит. Слой не влияет на процент и не создаёт объявлений.
 */
import {
  RING_GEOMETRY as G,
  RING_MOTION as M,
  bandTaper,
  clamp01,
  easeOutCubic,
  edgeOffset,
  flowIntensity,
  pulseIntensity,
  toScreenRad,
  voiceAmplitude,
  waveCenters,
  waveProfile,
  zoneAngles,
  zoneWeight,
} from './geometry';

type RGB = readonly [number, number, number];

interface Palette {
  /** Насыщенная кромка: видна на светлом стекле даже там, где свечение растворяется. */
  rim: RGB;
  /** Яркое ядро поля. */
  core: RGB;
  /** Широкое рассеянное свечение. */
  glow: RGB;
}

const hex = (h: string): RGB => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];

/** Холодные поля: фиолетовый → синий → бирюзовый → лазурный и снова фиолетовый на стыке q4/q1. */
export const COLD_PALETTES: readonly Palette[] = [
  { rim: hex('#6A4CF5'), core: hex('#7F5CFF'), glow: hex('#9A80FF') },
  { rim: hex('#2F67FF'), core: hex('#3F74FF'), glow: hex('#6B93FF') },
  { rim: hex('#0E9AA8'), core: hex('#14B4C2'), glow: hex('#36CCD6') },
  { rim: hex('#2A86F2'), core: hex('#3590FF'), glow: hex('#68ADFF') },
];

/** Предупреждение «нужно уточнение»: красно-оранжевый. */
export const WARM_PALETTE: Palette = { rim: hex('#E2441E'), core: hex('#FF5A2E'), glow: hex('#FF8A55') };

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(clamp01(a) * 1000) / 1000})`;

/** Значение, плавно идущее к цели за заданное время. Время — performance.now(). */
class Tween {
  private from: number;
  private to: number;
  private start = 0;
  private duration = 0;

  constructor(value: number) {
    this.from = value;
    this.to = value;
  }

  get target(): number {
    return this.to;
  }

  value(now: number): number {
    if (this.duration <= 0 || now >= this.start + this.duration) return this.to;
    if (now <= this.start) return this.from;
    return this.from + (this.to - this.from) * easeOutCubic((now - this.start) / this.duration);
  }

  set(target: number, now: number, duration: number): void {
    if (target === this.to) return;
    this.from = this.value(now);
    this.to = target;
    this.start = now;
    this.duration = duration;
  }

  snap(target: number): void {
    this.from = target;
    this.to = target;
    this.duration = 0;
  }
}

export interface LightRingState {
  /** Четверть полностью подтверждена: держит ровный свет. */
  zoneComplete: readonly boolean[];
  /** Последняя актуальная проверка вопроса требует уточнения. */
  zoneAttention: readonly boolean[];
  /** Четверть, где сейчас идёт запись (после старта MediaRecorder). */
  recordingZone: number | null;
  /** Четверть, для которой ждём распознавание или анализ. */
  busyZone: number | null;
  reducedMotion: boolean;
}

const EMPTY_STATE: LightRingState = {
  zoneComplete: [false, false, false, false],
  zoneAttention: [false, false, false, false],
  recordingZone: null,
  busyZone: null,
  reducedMotion: false,
};

type Layer = 'core' | 'glow';
type Tone = 'cold' | 'warm';

const RIM_SAMPLES = 240;
/** Разрешение буфера размытых полей относительно CSS px: свет мягкий, полного разрешения не требует. */
const FIELD_RES = 0.5;
const BAND_SAMPLES = 72;
const GRADIENT_STEP_DEG = 5;

export class LightRingRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Буфер полей в половинном разрешении: спрайты рисуются 1:1, на холст — одно масштабирование. */
  private readonly field: HTMLCanvasElement;
  private readonly fctx: CanvasRenderingContext2D | null;
  private cssSize: number = G.viewBox;
  private dpr = 1;
  private sized = false;
  private sprites = new Map<string, HTMLCanvasElement>();
  private state: LightRingState = EMPTY_STATE;
  private level = 0;
  private raf = 0;
  private running = false;
  private readonly band = [0, 1, 2, 3].map(() => new Tween(0));
  private readonly voice = [0, 1, 2, 3].map(() => new Tween(0));
  private readonly warmth = [0, 1, 2, 3].map(() => new Tween(0));
  private readonly steady = [0, 1, 2, 3].map(() => new Tween(0));
  private readonly dim = new Tween(0);
  private readonly conic: boolean;

  static create(canvas: HTMLCanvasElement | null): LightRingRenderer | null {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    return ctx ? new LightRingRenderer(canvas, ctx) : null;
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
  ) {
    this.ctx = ctx;
    this.conic = typeof ctx.createConicGradient === 'function';
    this.field = document.createElement('canvas');
    this.fctx = this.field.getContext('2d');
  }

  /** cssSize — сторона viewBox в CSS px (220 или 200 на компактном desktop). */
  resize(cssSize: number): void {
    const size = cssSize > 0 ? cssSize : G.viewBox;
    const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    if (this.sized && size === this.cssSize && dpr === this.dpr) return;
    this.sized = true;
    this.cssSize = size;
    this.dpr = dpr;
    const full = (G.viewBox + 2 * G.lightBleed) * (size / G.viewBox);
    this.canvas.width = Math.round(full * dpr);
    this.canvas.height = Math.round(full * dpr);
    this.field.width = Math.max(1, Math.round(full * FIELD_RES));
    this.field.height = this.field.width;
    this.sprites.clear();
    this.redrawIfIdle();
  }

  setState(next: LightRingState): void {
    const now = performance.now();
    this.state = next;
    const instant = next.reducedMotion || !this.running;
    for (let z = 0; z < 4; z += 1) {
      const rec = next.recordingZone === z ? 1 : 0;
      this.apply(this.band[z]!, rec, now, rec ? M.bandIn : M.bandOut, instant);
      // Голосовая волна гаснет за 180–250 ms после остановки.
      this.apply(this.voice[z]!, rec, now, rec ? M.bandIn : M.voiceFade, instant);
      this.apply(this.warmth[z]!, next.zoneAttention[z] ? 1 : 0, now, M.warmthTransition, instant);
      this.apply(this.steady[z]!, next.zoneComplete[z] ? 1 : 0, now, M.warmthTransition, instant);
    }
    this.apply(this.dim, next.recordingZone !== null ? 1 : 0, now, next.recordingZone !== null ? M.bandIn : M.bandOut, instant);
    this.redrawIfIdle();
  }

  /** Сглаженный уровень микрофона 0…1 (или статичный уровень галереи). */
  setLevel(level: number): void {
    this.level = clamp01(level);
  }

  /** Цикл анимации: только при видимой вкладке и без reduced motion. */
  setRunning(running: boolean): void {
    if (running === this.running) {
      if (!running) this.redrawIfIdle();
      return;
    }
    this.running = running;
    if (running) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.redrawIfIdle();
    }
  }

  destroy(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.sprites.clear();
  }

  private apply(t: Tween, target: number, now: number, duration: number, instant: boolean): void {
    if (instant) t.snap(target);
    else t.set(target, now, duration);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.running) return;
    this.draw(now, true);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Без цикла (reduced motion или скрытая вкладка) рисуется один статичный кадр текущего состояния. */
  private redrawIfIdle(): void {
    if (this.running) return;
    this.draw(performance.now(), false);
  }

  // ---------- рисование ----------

  private draw(now: number, motion: boolean): void {
    const { ctx } = this;
    const k = (this.cssSize / G.viewBox) * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, G.lightBleed * k, G.lightBleed * k);

    const s = this.state;
    const zones = [0, 1, 2, 3].map((z) => this.zoneLook(z, now, motion));

    // 1. Нижний слой: четыре размытых поля с перекрытием на стыках (буфер половинного разрешения).
    const f = this.fctx;
    const fs = this.fieldScale();
    if (f) {
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.clearRect(0, 0, this.field.width, this.field.height);
      f.setTransform(fs, 0, 0, fs, G.lightBleed * fs, G.lightBleed * fs);
    }
    for (let z = 0; z < 4; z += 1) {
      const look = zones[z]!;
      const sway = motion ? 3.5 * Math.sin((2 * Math.PI * now) / 5200 + z * 1.3) * (1 - look.steady) * (1 - look.band) : 0;
      // Тёплое предупреждение светит заметнее холодного фона, чтобы читаться на светлом стекле.
      const warmBoost = 1 + 0.55 * look.warm;
      const glowAlpha = (0.56 * look.glowI + 0.3 * look.band) * warmBoost;
      const coreAlpha = (0.66 * look.coreI + 0.25 * look.band) * warmBoost;
      this.drawSprite(z, 'glow', look.warm, glowAlpha, sway * 0.6);
      this.drawSprite(z, 'core', look.warm, coreAlpha, sway);
    }
    const full = G.viewBox + 2 * G.lightBleed;
    ctx.drawImage(this.field, -G.lightBleed, -G.lightBleed, full, full);
    // Светлая подложка центра — статичный CSS-слой .vpr__backdrop поверх холста.

    // Мягкая глубина: едва заметная тень с внутренней стороны обода.
    ctx.strokeStyle = 'rgba(48,60,150,0.06)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(G.center, G.center, G.radius - 3.2, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Средний слой: непрерывный обод.
    this.drawRim(zones, now, motion);

    // Лента записи поверх обода своей четверти.
    for (let z = 0; z < 4; z += 1) {
      if (zones[z]!.band > 0.01) this.drawBand(z, zones[z]!, now, motion, s.reducedMotion);
    }
  }

  private zoneLook(z: number, now: number, motion: boolean) {
    const s = this.state;
    const warm = this.warmth[z]!.value(now);
    const steady = this.steady[z]!.value(now);
    const band = this.band[z]!.value(now);
    const dim = this.dim.value(now);
    const recordingHere = s.recordingZone === z;
    const busyHere = s.busyZone === z;
    let coreI = motion ? flowIntensity(z, now) : 0.62;
    let glowI = motion ? flowIntensity(z, now, 650) : 0.62;
    coreI += (0.72 - coreI) * steady;
    glowI += (0.72 - glowI) * steady;
    // Тёплая пульсация 2,4 s; во время записи уточнения и ожидания она приостановлена.
    const pulseOn = motion && s.zoneAttention[z] && !recordingHere && !busyHere;
    const pulse = pulseOn ? pulseIntensity(now) : 0.64;
    coreI += (pulse - coreI) * warm;
    glowI += (pulse - glowI) * warm;
    // В остальных зонах базовое движение приглушается; тёплое предупреждение остаётся различимым.
    if (!recordingHere) {
      const k = 1 - (1 - M.dimDuring) * dim * (1 - 0.75 * warm);
      coreI *= k;
      glowI *= k;
    }
    return { warm, steady, band, coreI, glowI, edge: motion ? (1 - steady) * (1 - band) : 0 };
  }

  private palette(z: number, warm: number): Palette {
    const c = COLD_PALETTES[z]!;
    if (warm <= 0) return c;
    return { rim: mix(c.rim, WARM_PALETTE.rim, warm), core: mix(c.core, WARM_PALETTE.core, warm), glow: mix(c.glow, WARM_PALETTE.glow, warm) };
  }

  private fieldScale(): number {
    return (this.cssSize / G.viewBox) * FIELD_RES;
  }

  private drawSprite(z: number, layer: Layer, warm: number, alpha: number, swayDeg: number): void {
    const ctx = this.fctx;
    if (!ctx) return;
    const draw = (tone: Tone, a: number) => {
      if (a <= 0.004) return;
      const sprite = this.sprite(z, layer, tone);
      ctx.save();
      ctx.globalAlpha = clamp01(a);
      if (swayDeg !== 0) {
        ctx.translate(G.center, G.center);
        ctx.rotate((swayDeg * Math.PI) / 180);
        ctx.translate(-G.center, -G.center);
      }
      const full = G.viewBox + 2 * G.lightBleed;
      ctx.drawImage(sprite, -G.lightBleed, -G.lightBleed, full, full);
      ctx.restore();
    };
    draw('cold', alpha * (1 - warm));
    draw('warm', alpha * warm);
  }

  /** Заранее размытый спрайт поля: размытие считается один раз, в кадре меняются поворот и прозрачность. */
  private sprite(z: number, layer: Layer, tone: Tone): HTMLCanvasElement {
    const key = `${z}:${layer}:${tone}`;
    const cached = this.sprites.get(key);
    if (cached) return cached;
    const scale = this.fieldScale(); // размытому свету достаточно половинного разрешения
    const full = G.viewBox + 2 * G.lightBleed;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(full * scale));
    canvas.height = canvas.width;
    const c = canvas.getContext('2d');
    if (c) {
      const pal = tone === 'warm' ? WARM_PALETTE : COLD_PALETTES[z]!;
      const color = layer === 'core' ? pal.core : pal.glow;
      const width = layer === 'core' ? 5 : 16;
      const blur = layer === 'core' ? 7 : 24;
      const radius = layer === 'core' ? G.radius : G.radius + 3;
      const far = 4000;
      c.setTransform(scale, 0, 0, scale, (G.lightBleed - far) * scale, G.lightBleed * scale);
      // Рисуем фигуру далеко за краем; на холст попадает только её размытая тень.
      c.shadowOffsetX = far * scale;
      c.shadowBlur = blur * scale;
      c.shadowColor = rgba(color, 1);
      c.lineWidth = width;
      c.lineCap = 'butt';
      const { start, end } = zoneAngles(z);
      const overlap = 18;
      if (this.conic && c.createConicGradient) {
        const grad = c.createConicGradient(toScreenRad(0), G.center, G.center);
        for (let deg = 0; deg <= 360; deg += GRADIENT_STEP_DEG) grad.addColorStop(deg / 360, rgba(color, zoneWeight(z, deg)));
        c.strokeStyle = grad;
        c.beginPath();
        c.arc(G.center, G.center, radius, toScreenRad(start - overlap - 8), toScreenRad(end + overlap + 8));
        c.stroke();
      } else {
        for (let deg = start - overlap - 8; deg < end + overlap + 8; deg += 3) {
          c.strokeStyle = rgba(color, zoneWeight(z, deg + 1.5));
          c.beginPath();
          c.arc(G.center, G.center, radius, toScreenRad(deg), toScreenRad(deg + 3));
          c.stroke();
        }
      }
    }
    this.sprites.set(key, canvas);
    return canvas;
  }

  private drawRim(zones: ReturnType<LightRingRenderer['zoneLook']>[], now: number, motion: boolean): void {
    const { ctx } = this;
    const pals = zones.map((look, z) => this.palette(z, look.warm));
    const path = new Path2D();
    for (let i = 0; i <= RIM_SAMPLES; i += 1) {
      const deg = (i / RIM_SAMPLES) * 360;
      let r = G.radius;
      if (motion) {
        for (let z = 0; z < 4; z += 1) {
          const w = zoneWeight(z, deg);
          if (w > 0) r += w * zones[z]!.edge * edgeOffset(z, deg, now);
        }
      }
      const a = toScreenRad(deg);
      const x = G.center + r * Math.cos(a);
      const y = G.center + r * Math.sin(a);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();

    const colorAt = (deg: number): { c: RGB; i: number } => {
      let c: RGB = [0, 0, 0];
      let intensity = 0;
      for (let z = 0; z < 4; z += 1) {
        const w = zoneWeight(z, deg);
        if (w <= 0) continue;
        c = [c[0] + pals[z]!.rim[0] * w, c[1] + pals[z]!.rim[1] * w, c[2] + pals[z]!.rim[2] * w];
        intensity += w * zones[z]!.coreI;
      }
      return { c, i: intensity };
    };

    ctx.lineJoin = 'round';
    if (this.conic) {
      const grad = ctx.createConicGradient(toScreenRad(0), G.center, G.center);
      const halo = ctx.createConicGradient(toScreenRad(0), G.center, G.center);
      for (let deg = 0; deg <= 360; deg += GRADIENT_STEP_DEG) {
        const { c, i } = colorAt(deg % 360);
        grad.addColorStop(deg / 360, rgba(c, 0.8 + 0.2 * i));
        halo.addColorStop(deg / 360, rgba(c, 0.1 + 0.18 * i));
      }
      ctx.strokeStyle = halo;
      ctx.lineWidth = 7;
      ctx.stroke(path);
      ctx.strokeStyle = grad;
      ctx.lineWidth = G.rimWidth;
      ctx.stroke(path);
    } else {
      ctx.lineWidth = G.rimWidth;
      for (let deg = 0; deg < 360; deg += 4) {
        const { c, i } = colorAt(deg + 2);
        ctx.strokeStyle = rgba(c, 0.8 + 0.2 * i);
        ctx.beginPath();
        ctx.arc(G.center, G.center, G.radius, toScreenRad(deg), toScreenRad(deg + 4.4));
        ctx.stroke();
      }
    }
  }

  /** Лента записи: расширение до 12 px, две волны внутри маски четверти, мягкий внешний свет. */
  private drawBand(z: number, look: ReturnType<LightRingRenderer['zoneLook']>, now: number, motion: boolean, reduced: boolean): void {
    const { ctx } = this;
    const { start } = zoneAngles(z);
    const pal = this.palette(z, look.warm);
    const b = look.band;
    const amp = motion && !reduced ? voiceAmplitude(this.level) * this.voice[z]!.value(now) * b : 0;
    const hwMax = G.bandWidth / 2;
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    for (let i = 0; i <= BAND_SAMPLES; i += 1) {
      const u = i / BAND_SAMPLES;
      const taper = bandTaper(u);
      const hw = G.rimWidth / 2 + b * (hwMax - G.rimWidth / 2) * taper;
      const d = amp > 0 ? waveProfile(u, now, amp) * taper : 0;
      const a = toScreenRad(start + u * G.zoneSweep);
      const ro = G.radius + hw + d;
      const ri = G.radius - hw - 0.35 * d;
      outer.push([G.center + ro * Math.cos(a), G.center + ro * Math.sin(a)]);
      inner.push([G.center + ri * Math.cos(a), G.center + ri * Math.sin(a)]);
    }
    const path = new Path2D();
    outer.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    for (let i = inner.length - 1; i >= 0; i -= 1) path.lineTo(inner[i]![0], inner[i]![1]);
    path.closePath();

    // Цвет вдоль ленты: от ядра поля к его кромке, с соседними оттенками на концах.
    let fill: CanvasGradient | string = rgba(pal.rim, 0.95);
    if (this.conic) {
      const grad = ctx.createConicGradient(toScreenRad(0), G.center, G.center);
      const prev = this.palette((z + 3) % 4, 0).rim;
      const next = this.palette((z + 1) % 4, 0).rim;
      const s0 = start / 360;
      const span = G.zoneSweep / 360;
      grad.addColorStop(0, rgba(pal.rim, 0.95));
      grad.addColorStop(Math.max(0, s0), rgba(mix(pal.rim, prev, 0.25 * (1 - look.warm)), 0.95));
      grad.addColorStop(Math.min(1, s0 + span * 0.45), rgba(mix(pal.core, pal.rim, 0.35), 0.96));
      grad.addColorStop(Math.min(1, s0 + span), rgba(mix(pal.rim, next, 0.25 * (1 - look.warm)), 0.95));
      grad.addColorStop(1, rgba(pal.rim, 0.95));
      fill = grad;
    }
    ctx.save();
    // Мягкий край ленты без живого размытия: широкий полупрозрачный контур; основное свечение — спрайт поля.
    ctx.globalAlpha = 0.22 * b;
    ctx.strokeStyle = rgba(pal.glow, 1);
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.globalAlpha = clamp01(0.35 + 0.65 * b);
    ctx.fillStyle = fill;
    ctx.fill(path);
    ctx.restore();

    // Световая сердцевина ленты: светлее к середине толщины.
    const core = ctx.createRadialGradient(G.center, G.center, G.radius - hwMax - 4, G.center, G.center, G.radius + hwMax + 4);
    core.addColorStop(0, 'rgba(255,255,255,0)');
    core.addColorStop(0.5, `rgba(255,255,255,${0.3 * b})`);
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = core;
    ctx.fill(path);
    // Светлые пятна на гребнях волн — движутся вместе с волнами.
    if (amp > 0) {
      const [c1, c2] = waveCenters(now);
      const crest = (c: number, gain: number) => {
        if (c < -0.15 || c > 1.15) return;
        const a = toScreenRad(start + c * G.zoneSweep);
        const x = G.center + (G.radius + 1) * Math.cos(a);
        const y = G.center + (G.radius + 1) * Math.sin(a);
        const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
        const strength = (0.28 + 0.4 * (amp / M.voiceMaxAmplitude)) * gain;
        g.addColorStop(0, `rgba(255,255,255,${clamp01(strength)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 12, y - 12, 24, 24);
      };
      crest(c1, 1);
      crest(c2, M.secondWaveGain);
    }
    ctx.restore();
  }
}
