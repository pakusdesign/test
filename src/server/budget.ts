/**
 * Общий бюджет серверного вызова провайдера: 45 секунд на операцию,
 * не больше одного автоматического повтора для 429/5xx внутри бюджета
 * (docs/04-architecture.md, «Надёжность»).
 */
import { AppError, ProviderHttpError, ProviderOutputError } from './errors';

export class ClientAbortedError extends Error {
  constructor() {
    super('client aborted');
    this.name = 'ClientAbortedError';
  }
}

export interface Budget {
  deadline: number;
  signal: AbortSignal;
}

export function createBudget(timeoutMs: number, parent: AbortSignal): Budget {
  return { deadline: Date.now() + timeoutMs, signal: parent };
}

export interface BudgetCallOptions {
  maxRetries?: number;
  /** Верхняя граница задержки перед повтором. */
  maxRetryDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onAttempt?: (attempt: number) => void;
}

const TIMEOUT_REASON = 'provider-timeout';

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ClientAbortedError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ClientAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryableProviderError(error: unknown): error is ProviderHttpError {
  return error instanceof ProviderHttpError && (error.status === 429 || error.status >= 500);
}

/** Преобразует ошибку провайдера в код API. Тело ответа провайдера клиенту не передаётся. */
export function mapProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ProviderHttpError) {
    if (error.status === 429) return new AppError('RATE_LIMITED', { retryAfterSeconds: error.retryAfterSeconds, detail: error.message });
    if (error.status === 401 || error.status === 403) {
      return new AppError('CONFIGURATION_ERROR', { detail: `${error.provider} отклонил ключ (${error.status})` });
    }
    return new AppError('PROVIDER_ERROR', { detail: error.message });
  }
  if (error instanceof ProviderOutputError) return new AppError('INVALID_MODEL_OUTPUT', { detail: error.message });
  return new AppError('PROVIDER_ERROR', { detail: error instanceof Error ? error.name : 'unknown' });
}

/**
 * Выполняет вызов с остатком бюджета. При 429/5xx — один повтор, если хватает времени.
 * Тайм-аут → PROVIDER_TIMEOUT; отмена клиентом → ClientAbortedError.
 */
export async function callWithBudget<T>(
  budget: Budget,
  fn: (signal: AbortSignal) => Promise<T>,
  options: BudgetCallOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 1;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 3000;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    if (budget.signal.aborted) throw new ClientAbortedError();
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0) throw new AppError('PROVIDER_TIMEOUT');
    options.onAttempt?.(attempt + 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), remaining);
    const onParentAbort = () => controller.abort('client');
    budget.signal.addEventListener('abort', onParentAbort, { once: true });
    try {
      return await fn(controller.signal);
    } catch (error) {
      if (budget.signal.aborted) throw new ClientAbortedError();
      if (controller.signal.aborted && controller.signal.reason === TIMEOUT_REASON) {
        throw new AppError('PROVIDER_TIMEOUT');
      }
      if (attempt < maxRetries && isRetryableProviderError(error)) {
        const suggested = error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : 800 * (attempt + 1);
        const delay = Math.min(suggested, maxRetryDelayMs);
        if (Date.now() + delay < budget.deadline - 250) {
          await sleep(delay, budget.signal);
          continue;
        }
      }
      throw mapProviderError(error);
    } finally {
      clearTimeout(timer);
      budget.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
