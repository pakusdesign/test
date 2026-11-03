/**
 * Логи этапов: requestId, этап, длительность, код, режим, модель, версия промпта.
 * Не логируем аудио, тексты ответов, ключи и текст вакансии.
 */
export interface LogEvent {
  requestId: string | null;
  route: string;
  stage: string;
  durationMs?: number;
  code?: string;
  mode: string;
  model?: string | null;
  promptVersion?: string;
  attempts?: number;
  status?: number;
  detail?: string;
}

export type LogSink = (event: LogEvent & { ts: string }) => void;

export interface Logger {
  log(event: LogEvent): void;
}

const ALLOWED_KEYS = new Set([
  'requestId',
  'route',
  'stage',
  'durationMs',
  'code',
  'mode',
  'model',
  'promptVersion',
  'attempts',
  'status',
  'detail',
]);

export function createLogger(sink: LogSink = (e) => console.log(JSON.stringify(e))): Logger {
  return {
    log(event) {
      // Белый список полей: случайно переданный текст пользователя не попадёт в лог.
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(event)) if (ALLOWED_KEYS.has(k) && v !== undefined) safe[k] = v;
      sink({ ts: new Date().toISOString(), ...(safe as unknown as LogEvent) });
    },
  };
}

export const silentLogger: Logger = { log() {} };
