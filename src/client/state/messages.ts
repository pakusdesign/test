/**
 * Тексты ошибок по матрице docs/11-interface-states.md. Каждая ошибка говорит:
 * что не удалось, что сохранилось и что можно сделать. Код HTTP — только в сведениях.
 */
import type { QuestionId } from '../../shared/constants';
import type { HttpFailure } from '../api/http';
import type { RecorderErrorKind } from '../audio/recorder';
import type { ActionError, Operation, RetryPlan } from './types';

const SAVED: Record<Operation, string> = {
  transcribe: 'Запись остаётся в этой вкладке.',
  analyze: 'Текст ответа и подтверждённые сведения сохранены.',
  generate: 'Подтверждённые факты и прежний документ сохранены.',
};

export const STAGE_LABELS: Record<Operation, string> = {
  transcribe: 'Преобразуем речь в текст',
  analyze: 'Проверяем, хватает ли сведений',
  generate: 'Составляем описание вакансии',
};

export function failureToError(
  op: Operation,
  failure: HttpFailure,
  ctx: { questionId: QuestionId | null; requestId: string; retry: RetryPlan; mode: 'demo' | 'live' },
): ActionError | null {
  const base = { op, questionId: ctx.questionId, requestId: ctx.requestId, retry: ctx.retry };
  const textAction = op === 'generate' ? [] : (['text'] as const);
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'timeout':
      return {
        ...base,
        stateId: 'S19',
        code: 'CLIENT_TIMEOUT',
        title: 'Сервис не ответил вовремя',
        message: 'Запрос остановлен по тайм-ауту.',
        saved: SAVED[op],
        retryable: true,
        actions: ['retry', ...textAction],
      };
    case 'network':
      if (op === 'transcribe' && !failure.uploadComplete) {
        return {
          ...base,
          stateId: 'N03',
          code: 'NETWORK',
          title: 'Не удалось отправить запись',
          message: 'Нет связи с сервисом.',
          saved: 'Она остаётся в этой вкладке.',
          retryable: true,
          actions: ['retry', 'text'],
        };
      }
      if (op === 'generate') {
        return {
          ...base,
          stateId: 'N05',
          code: 'NETWORK',
          title: 'Не удалось получить описание',
          message: 'Нет связи с сервисом.',
          saved: SAVED.generate,
          retryable: true,
          actions: ['retry'],
        };
      }
      return {
        ...base,
        stateId: 'N04',
        code: 'NETWORK',
        title: 'Не удалось получить ответ сервиса',
        message: 'Нет связи с сервисом. Повтор не создаст новый ответ.',
        saved: op === 'transcribe' ? 'Запись и текущий текст остаются в этой вкладке.' : SAVED.analyze,
        retryable: true,
        actions: ['retry', ...textAction],
      };
    case 'invalid_response':
      return {
        ...base,
        stateId: 'S20',
        code: 'INVALID_RESPONSE',
        title: 'Не удалось получить корректный результат',
        message: 'Ответ сервиса не прошёл проверку и не применён.',
        saved: SAVED[op],
        retryable: true,
        actions: ['retry'],
      };
    case 'http':
      return httpError(op, failure, base, ctx.mode);
  }
}

function httpError(
  op: Operation,
  failure: Extract<HttpFailure, { kind: 'http' }>,
  base: Pick<ActionError, 'op' | 'questionId' | 'requestId' | 'retry'>,
  mode: 'demo' | 'live',
): ActionError {
  const code = failure.error?.code ?? `HTTP_${failure.status}`;
  const serverMessage = failure.error?.message;
  const retryAfter = failure.error?.retryAfterSeconds;
  const common = { ...base, code, retryAfterSeconds: retryAfter };
  switch (code) {
    case 'NO_SPEECH':
      return {
        ...common,
        stateId: 'S04',
        title: 'Не удалось распознать речь',
        message: serverMessage && serverMessage !== 'Не удалось распознать речь' ? serverMessage : 'Запишите ответ ещё раз или введите текст.',
        saved: 'Полнота не изменилась.',
        retryable: false,
        actions: ['record_again', 'text'],
      };
    case 'UNSUPPORTED_AUDIO':
      return {
        ...common,
        stateId: 'S12',
        title: 'Формат записи не поддерживается',
        message: serverMessage ?? 'Сервис распознавания не принял этот формат.',
        saved: 'Запись остаётся в этой вкладке.',
        retryable: false,
        actions: ['text'],
      };
    case 'PAYLOAD_TOO_LARGE':
      return {
        ...common,
        stateId: 'S16',
        title: op === 'transcribe' ? 'Достигнут предел записи' : `Сократите ответ до 4000 символов`,
        message: serverMessage ?? 'Объём данных превышает лимит.',
        saved: 'Введённые данные сохранены.',
        retryable: false,
        actions: op === 'transcribe' ? ['record_again', 'text'] : ['dismiss'],
      };
    case 'RATE_LIMITED':
      return {
        ...common,
        stateId: 'S17',
        title: 'Слишком много запросов. Повторите позже',
        message: retryAfter !== undefined ? `Повторить можно примерно через ${retryAfter} с.` : 'Подождите немного перед повтором.',
        saved: SAVED[op],
        retryable: true,
        actions: ['retry'],
      };
    case 'PROVIDER_TIMEOUT':
      return {
        ...common,
        stateId: 'S19',
        title: 'Сервис не ответил вовремя',
        message: 'Сервис обработки не ответил за 45 секунд.',
        saved: SAVED[op],
        retryable: true,
        actions: op === 'generate' ? ['retry'] : ['retry', 'text'],
      };
    case 'INVALID_MODEL_OUTPUT':
      return {
        ...common,
        stateId: 'S20',
        title: 'Не удалось получить корректный результат',
        message: 'Результат модели не прошёл проверку. Повреждённые сведения не показаны.',
        saved: SAVED[op],
        retryable: true,
        actions: ['retry'],
      };
    case 'CONFIGURATION_ERROR':
      return {
        ...common,
        stateId: 'S24',
        title: op === 'analyze' ? 'Анализ ответа не подключён' : 'Обработка сейчас недоступна',
        message: 'Live-режим не настроен на сервере. Демонстрация не включается автоматически.',
        saved: op === 'transcribe' ? 'Запись остаётся в этой вкладке.' : 'Текстовый черновик сохранён.',
        retryable: false,
        actions: op === 'generate' ? ['dismiss'] : ['text'],
      };
    case 'STALE_REVISION':
      return {
        ...common,
        stateId: 'S22',
        title: 'Ответы изменились',
        message: 'Результат не применён. Повторите с актуальными данными.',
        saved: SAVED[op],
        retryable: true,
        actions: ['retry'],
      };
    case 'INSUFFICIENT_FACTS':
      return {
        ...common,
        stateId: 'S06',
        title: 'Пока недостаточно данных для описания',
        message: 'Подтвердите хотя бы один факт.',
        saved: 'Ответы сохранены.',
        retryable: false,
        actions: ['back_to_answers'],
      };
    case 'DEMO_UNSUPPORTED_TEXT':
      return {
        ...common,
        stateId: 'DEMO',
        title: 'В демонстрации нет анализа для этого текста',
        message:
          (serverMessage ?? 'Демонстрация анализирует только тексты тестовых сценариев.') +
          (mode === 'demo' ? ' Выдуманный анализ не показывается.' : ''),
        saved: 'Текст ответа сохранён.',
        retryable: false,
        actions: ['choose_scenario'],
      };
    case 'INVALID_REQUEST':
      return {
        ...common,
        stateId: 'S18',
        title: 'Не удалось обработать ответ',
        message: serverMessage ?? 'Сервер отклонил запрос.',
        saved: SAVED[op],
        retryable: false,
        actions: ['dismiss'],
      };
    default:
      return {
        ...common,
        stateId: 'S18',
        title: op === 'generate' ? 'Не удалось получить описание' : 'Не удалось обработать ответ',
        message: 'Сервис обработки вернул ошибку.',
        saved: SAVED[op],
        retryable: true,
        actions: op === 'generate' ? ['retry'] : ['retry', 'text'],
      };
  }
}

export function micError(kind: RecorderErrorKind, questionId: QuestionId): ActionError {
  const base = { op: 'record' as const, questionId, code: `MIC_${kind.toUpperCase()}`, retryable: false };
  switch (kind) {
    case 'permission_denied':
      return {
        ...base,
        stateId: 'S11',
        title: 'Нет доступа к микрофону',
        message: 'Разрешите микрофон в настройках сайта (значок слева от адреса) и нажмите «Повторить».',
        saved: 'Ответы и прогресс сохранены.',
        actions: ['mic_retry', 'text'],
      };
    case 'no_device':
      return {
        ...base,
        stateId: 'S12',
        title: 'Микрофон не найден',
        message: 'Подключите микрофон или ответьте текстом.',
        saved: 'Ответы и прогресс сохранены.',
        actions: ['mic_retry', 'text'],
      };
    case 'device_busy':
      return {
        ...base,
        stateId: 'S12',
        title: 'Микрофон занят или недоступен',
        message: 'Закройте другие приложения, которые используют микрофон, или ответьте текстом.',
        saved: 'Ответы и прогресс сохранены.',
        actions: ['mic_retry', 'text'],
      };
    case 'insecure_context':
      return {
        ...base,
        stateId: 'S12',
        title: 'Запись недоступна в этом браузере',
        message: 'Микрофон работает только по HTTPS или на localhost.',
        saved: 'Ответы и прогресс сохранены.',
        actions: ['text'],
      };
    case 'unsupported_api':
      return {
        ...base,
        stateId: 'S12',
        title: 'Запись недоступна в этом браузере',
        message: 'Браузер не поддерживает запись звука (MediaRecorder).',
        saved: 'Ответы и прогресс сохранены.',
        actions: ['text'],
      };
    case 'aborted':
    case 'recorder_error':
    default:
      return {
        ...base,
        stateId: 'S13',
        title: 'Запись прервана',
        message: 'Не удалось записать звук. Попробуйте ещё раз или ответьте текстом.',
        saved: 'Ответы и прогресс сохранены.',
        actions: ['mic_retry', 'text'],
      };
  }
}
