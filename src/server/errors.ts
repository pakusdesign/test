import { ERROR_HTTP_STATUS, SCHEMA_VERSION, type ErrorCode } from '../shared/constants';
import type { ErrorResponse } from '../shared/schemas';

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: 'Некорректный запрос',
  PAYLOAD_TOO_LARGE: 'Слишком большой объём данных',
  UNSUPPORTED_AUDIO: 'Формат записи не поддерживается',
  NO_SPEECH: 'Не удалось распознать речь',
  INVALID_MODEL_OUTPUT: 'Не удалось получить корректный результат',
  INSUFFICIENT_FACTS: 'Пока недостаточно данных для описания',
  STALE_REVISION: 'Ответы изменились. Повторите с актуальными данными',
  RATE_LIMITED: 'Слишком много запросов. Повторите позже',
  PROVIDER_ERROR: 'Не удалось обработать ответ',
  CONFIGURATION_ERROR: 'Обработка сейчас недоступна',
  PROVIDER_TIMEOUT: 'Сервис не ответил вовремя',
  DEMO_UNSUPPORTED_TEXT: 'В демонстрации анализируется только текст тестовых сценариев',
  NOT_FOUND: 'Маршрут не найден',
  INTERNAL_ERROR: 'Внутренняя ошибка сервера',
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'PROVIDER_TIMEOUT',
  'INVALID_MODEL_OUTPUT',
]);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterSeconds?: number;
  /** Подробности только для лога: без текстов пользователя и тел ответов провайдера. */
  readonly detail?: string;

  constructor(code: ErrorCode, options: { message?: string; retryAfterSeconds?: number; detail?: string } = {}) {
    super(options.message ?? DEFAULT_ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.detail = options.detail;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

/** Ошибка HTTP-ответа провайдера. Тело не сохраняется. */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`${provider} HTTP ${status}`);
    this.name = 'ProviderHttpError';
  }
}

/** Ответ провайдера не соответствует ожидаемому формату. */
export class ProviderOutputError extends Error {
  constructor(
    readonly provider: string,
    reason: string,
  ) {
    super(`${provider}: ${reason}`);
    this.name = 'ProviderOutputError';
  }
}

export function errorBody(requestId: string | null, error: AppError): ErrorResponse {
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  };
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 3600);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}
