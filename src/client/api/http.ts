/**
 * HTTP-клиент. Различает: ответ сервера с ошибкой, сетевой сбой (до или после
 * отправки тела), тайм-аут и отмену. Navigator.onLine не используется как доказательство.
 */
import type { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import { ErrorResponseSchema, type ErrorResponse } from '../../shared/schemas';

export type HttpFailure =
  | { kind: 'aborted' }
  | { kind: 'timeout' }
  | { kind: 'network'; uploadComplete: boolean }
  | { kind: 'http'; status: number; error: ErrorResponse['error'] | null }
  | { kind: 'invalid_response'; status: number };

export type HttpResult<T> = { ok: true; data: T } | { ok: false; failure: HttpFailure };

function parseError(status: number, body: unknown): HttpFailure {
  const parsed = ErrorResponseSchema.safeParse(body);
  return { kind: 'http', status, error: parsed.success ? parsed.data.error : null };
}

export async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<HttpResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' }, signal, cache: 'no-store' });
  } catch (error) {
    if (signal?.aborted) return { ok: false, failure: { kind: 'aborted' } };
    void error;
    return { ok: false, failure: { kind: 'network', uploadComplete: false } };
  }
  return readResponse(response, schema);
}

async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<HttpResult<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: response.ok ? { kind: 'invalid_response', status: response.status } : parseError(response.status, null) };
  }
  if (!response.ok) return { ok: false, failure: parseError(response.status, body) };
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, failure: { kind: 'invalid_response', status: response.status } };
  return { ok: true, data: parsed.data };
}

/** POST JSON с тайм-аутом клиента и внешней отменой. */
export async function postJson<T>(
  path: string,
  payload: unknown,
  schema: z.ZodType<T>,
  options: { signal: AbortSignal; timeoutMs?: number },
): Promise<HttpResult<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? LIMITS.clientRequestTimeoutMs);
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) return { ok: false, failure: { kind: 'timeout' } };
      if (options.signal.aborted) return { ok: false, failure: { kind: 'aborted' } };
      // Для небольшого JSON нельзя точно знать, дошло ли тело: считаем, что ответ не получен.
      return { ok: false, failure: { kind: 'network', uploadComplete: true } };
    }
    return await readResponse(response, schema);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * multipart через XMLHttpRequest: событие upload.load отделяет
 * «не удалось отправить запись» (N03) от «не получен ответ» (N04).
 */
export function postForm<T>(
  path: string,
  form: FormData,
  schema: z.ZodType<T>,
  options: { signal: AbortSignal; timeoutMs?: number },
): Promise<HttpResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let uploadComplete = false;
    let settled = false;
    const done = (result: HttpResult<T>) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => {
      xhr.abort();
      done({ ok: false, failure: { kind: 'aborted' } });
    };
    xhr.open('POST', path);
    xhr.responseType = 'text';
    xhr.timeout = options.timeoutMs ?? LIMITS.clientRequestTimeoutMs;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onload = () => {
      uploadComplete = true;
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) return done({ ok: false, failure: parseError(xhr.status, body) });
      const parsed = schema.safeParse(body);
      done(parsed.success ? { ok: true, data: parsed.data } : { ok: false, failure: { kind: 'invalid_response', status: xhr.status } });
    };
    xhr.onerror = () => done({ ok: false, failure: { kind: 'network', uploadComplete } });
    xhr.ontimeout = () => done({ ok: false, failure: { kind: 'timeout' } });
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) return onAbort();
    xhr.send(form);
  });
}
