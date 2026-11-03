/**
 * Запись ответа: getUserMedia только по нажатию, MediaRecorder с проверкой формата,
 * Web Audio для уровня ореола. Все ресурсы (tracks, AudioContext, rAF, таймеры)
 * освобождаются при stop, cancel и прерывании. Сетевые события запись не останавливают.
 */
import { rmsFromSamples, rmsToLevel, smoothLevel, type AudioMeter, type LevelListener } from './level';
import { MOTION_MS } from '../styles/tokens';

export type RecorderErrorKind =
  | 'unsupported_api'
  | 'insecure_context'
  | 'permission_denied'
  | 'no_device'
  | 'device_busy'
  | 'recorder_error'
  | 'aborted';

export class RecorderError extends Error {
  constructor(readonly kind: RecorderErrorKind) {
    super(kind);
    this.name = 'RecorderError';
  }
}

export const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'] as const;

export function recordingSupport(win: Window = window): { ok: true } | { ok: false; kind: RecorderErrorKind } {
  if (!win.isSecureContext) return { ok: false, kind: 'insecure_context' };
  const hasRecorder = typeof (win as Window & { MediaRecorder?: unknown }).MediaRecorder !== 'undefined';
  if (!win.navigator.mediaDevices?.getUserMedia || !hasRecorder) {
    return { ok: false, kind: 'unsupported_api' };
  }
  return { ok: true };
}

/** Первый поддерживаемый MIME из списка; undefined — формат выберет браузер. */
export function pickMimeType(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string | undefined {
  return MIME_PREFERENCE.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  });
}

export function mapGetUserMediaError(error: unknown): RecorderErrorKind {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no_device';
    case 'NotReadableError':
    case 'AbortError':
      return 'device_busy';
    case 'TypeError':
      return 'unsupported_api';
    default:
      return 'recorder_error';
  }
}

export interface RecordedAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
}

export type StopReason = 'user' | 'limit_duration' | 'limit_size' | 'interrupted';

export interface ActiveRecording {
  readonly mimeType: string;
  readonly startedAt: number;
  readonly meter: AudioMeter;
  /** Завершает запись и ждёт финального dataavailable. */
  stop(): Promise<RecordedAudio>;
  /** Прерывает запись без сохранения данных. */
  cancel(): void;
}

export interface StartRecordingOptions {
  maxDurationMs: number;
  maxBytes: number;
  /** Запись остановлена автоматически (лимит или потеря трека); данные уже собраны. */
  onAutoStop: (reason: Exclude<StopReason, 'user'>, audio: RecordedAudio | null) => void;
  /** Только для проверок: перехват созданных потоков. */
  onStream?: (stream: MediaStream) => void;
}

class WebAudioMeter implements AudioMeter {
  private listeners = new Set<LevelListener>();
  private raf = 0;
  private last = 0;
  private level = 0;
  private readonly buffer: Float32Array<ArrayBuffer>;
  private stopped = false;

  constructor(
    private readonly context: AudioContext,
    private readonly analyser: AnalyserNode,
  ) {
    this.buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.pause();
    else this.resume();
  };

  private tick = (now: number) => {
    this.raf = 0;
    if (this.stopped || this.listeners.size === 0) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const target = rmsToLevel(rmsFromSamples(this.buffer));
    const dt = this.last ? now - this.last : 16;
    this.last = now;
    this.level = smoothLevel(this.level, target, dt, MOTION_MS.audioAttack, MOTION_MS.audioRelease);
    for (const l of this.listeners) l(this.level);
    this.raf = requestAnimationFrame(this.tick);
  };

  private pause() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resume() {
    if (this.stopped || this.raf || this.listeners.size === 0 || document.visibilityState === 'hidden') return;
    this.last = 0; // пропущенные кадры не проигрываются
    this.raf = requestAnimationFrame(this.tick);
  }

  subscribe(listener: LevelListener): () => void {
    this.listeners.add(listener);
    this.resume();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.pause();
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pause();
    this.listeners.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.context.close().catch(() => undefined);
  }
}

export async function startRecording(options: StartRecordingOptions): Promise<ActiveRecording> {
  const support = recordingSupport();
  if (!support.ok) throw new RecorderError(support.kind);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    throw new RecorderError(mapGetUserMediaError(error));
  }
  options.onStream?.(stream);

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new RecorderError('recorder_error');
  }

  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const meter = new WebAudioMeter(context, analyser);

  const chunks: Blob[] = [];
  let bytes = 0;
  const startedAt = performance.now();
  let finished = false;
  let cancelled = false;
  let stopReason: StopReason = 'user';
  let resolveStop: ((audio: RecordedAudio) => void) | null = null;
  let rejectStop: ((error: Error) => void) | null = null;
  const stopPromise = new Promise<RecordedAudio>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });
  stopPromise.catch(() => undefined);

  const releaseResources = () => {
    window.clearTimeout(durationTimer);
    stream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    meter.stop();
  };

  const finish = (): RecordedAudio => {
    const type = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
    const blob = new Blob(chunks, { type });
    return { blob, mimeType: type, durationMs: Math.round(performance.now() - startedAt), sizeBytes: blob.size };
  };

  const requestStop = (reason: StopReason) => {
    if (finished) return;
    stopReason = reason;
    if (recorder.state !== 'inactive') recorder.stop();
    else onStop();
  };

  recorder.ondataavailable = (event) => {
    if (cancelled || !event.data || event.data.size === 0) return;
    chunks.push(event.data);
    bytes += event.data.size;
    // Запас 64 КиБ на последний фрагмент; лимит сервера 10 МиБ.
    if (bytes >= options.maxBytes - 64 * 1024) requestStop('limit_size');
  };

  const onStop = () => {
    if (finished) return;
    finished = true;
    releaseResources();
    if (cancelled) {
      rejectStop?.(new RecorderError('aborted'));
      return;
    }
    const audio = finish();
    resolveStop?.(audio);
    if (stopReason !== 'user') options.onAutoStop(stopReason, audio.sizeBytes > 0 ? audio : null);
  };
  recorder.onstop = onStop;
  recorder.onerror = () => {
    stopReason = 'interrupted';
    if (recorder.state !== 'inactive') recorder.stop();
    else onStop();
  };

  for (const track of stream.getAudioTracks()) {
    track.onended = () => requestStop('interrupted');
  }

  const durationTimer = window.setTimeout(() => requestStop('limit_duration'), options.maxDurationMs);

  try {
    recorder.start(1000);
  } catch {
    finished = true;
    releaseResources();
    throw new RecorderError('recorder_error');
  }

  return {
    mimeType: mimeType ?? recorder.mimeType,
    startedAt: Date.now(),
    meter,
    stop() {
      requestStop('user');
      return stopPromise;
    },
    cancel() {
      cancelled = true;
      requestStop('user');
    },
  };
}
