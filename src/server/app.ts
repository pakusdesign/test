/**
 * HTTP API (docs/05-contracts.md). Сервер — граница доверия: проверяет вход,
 * лимиты, ответы моделей и источники.
 */
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import {
  LIMITS,
  SCHEMA_VERSION,
  SUPPORTED_AUDIO_TYPES,
  baseMimeType,
} from '../shared/constants';
import {
  AnalyzeRequestSchema,
  GenerateRequestSchema,
  TranscribeFieldsSchema,
  type AnalyzeResponse,
  type ConfigResponse,
  type GenerateResponse,
  type TranscribeResponse,
} from '../shared/schemas';
import { ClientAbortedError, callWithBudget, createBudget } from './budget';
import type { ServerConfig } from './config';
import { DEMO_SCENARIOS, demoCatalogByQuestion } from './demo/catalog';
import { AppError, errorBody } from './errors';
import { silentLogger, type Logger } from './logger';
import { runAnalysis, runGeneration } from './pipeline';
import { liveReadiness } from './providers';
import type { Providers } from './providers/types';
import { createRateLimiter } from './rateLimit';

export interface AppDeps {
  config: ServerConfig;
  providers: Providers;
  logger?: Logger;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function pickRequestId(value: unknown): string | null {
  if (value && typeof value === 'object' && 'requestId' in value) {
    const id = (value as { requestId: unknown }).requestId;
    if (typeof id === 'string' && REQUEST_ID_RE.test(id)) return id;
  }
  return null;
}

function zodMessage(error: ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.map(String).join('.') || 'тело'}: ${first.message}` : 'Некорректный запрос';
}

export function createApp({ config, providers, logger = silentLogger }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const limiter = createRateLimiter(config.rateLimitPerMinute);
  const readiness = liveReadiness(config);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  const send = (res: Response, requestId: string | null, route: string, started: number, error: unknown) => {
    if (error instanceof ClientAbortedError) {
      logger.log({ requestId, route, stage: 'aborted_by_client', mode: config.mode, durationMs: Date.now() - started });
      if (!res.headersSent) res.end();
      return;
    }
    const appError =
      error instanceof AppError
        ? error
        : error instanceof ZodError
          ? new AppError('INVALID_REQUEST', { message: zodMessage(error) })
          : new AppError('INTERNAL_ERROR', { detail: error instanceof Error ? error.name : 'unknown' });
    logger.log({
      requestId,
      route,
      stage: 'error',
      code: appError.code,
      status: appError.status,
      mode: config.mode,
      durationMs: Date.now() - started,
      detail: appError.detail,
    });
    if (res.headersSent) return;
    if (appError.retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    res.status(appError.status).json(errorBody(requestId, appError));
  };

  /** Сигнал отмены: клиент закрыл соединение до ответа. */
  const clientSignal = (res: Response): AbortSignal => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    return controller.signal;
  };

  const rateLimit = (req: Request) => {
    if (config.mode !== 'live') return;
    const verdict = limiter.check(req.ip ?? 'unknown');
    if (!verdict.allowed) throw new AppError('RATE_LIMITED', { retryAfterSeconds: verdict.retryAfterSeconds });
  };

  // ---------- GET /api/config ----------
  app.get('/api/config', (_req, res) => {
    const body: ConfigResponse = {
      schemaVersion: SCHEMA_VERSION,
      mode: config.mode,
      limits: {
        maxRecordingSeconds: LIMITS.maxRecordingSeconds,
        maxAudioBytes: LIMITS.maxAudioBytes,
        maxAnswerChars: LIMITS.maxAnswerChars,
        maxActiveAnswers: LIMITS.maxActiveAnswers,
        maxSessionChars: LIMITS.maxSessionChars,
        maxClarificationsPerQuestion: LIMITS.maxClarificationsPerQuestion,
      },
      ...(config.mode === 'live'
        ? {
            live: {
              ...readiness,
              sttProvider: config.sttProvider,
              sttModel: config.sttModel,
              sttLanguage: config.sttLanguage,
              llmModel: config.llmModel,
            },
          }
        : { demo: { scenarios: DEMO_SCENARIOS, catalog: demoCatalogByQuestion() } }),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  // ---------- POST /api/transcribe ----------
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.maxAudioBytes, files: 1, fields: 10, fieldSize: 2048, parts: 12 },
  });

  app.post(
    '/api/transcribe',
    (req: Request, res: Response, next: NextFunction) => {
      const started = Date.now();
      // Ограничение размера до чтения тела.
      const length = Number(req.headers['content-length'] ?? 0);
      if (length > LIMITS.maxAudioBytes + 64 * 1024) {
        send(res, null, 'transcribe', started, new AppError('PAYLOAD_TOO_LARGE', { message: 'Запись больше 10 МиБ' }));
        req.resume();
        return;
      }
      try {
        rateLimit(req);
      } catch (error) {
        send(res, null, 'transcribe', started, error);
        req.resume();
        return;
      }
      upload.single('audio')(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
          const tooLarge = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FIELD_VALUE';
          send(
            res,
            pickRequestId(req.body),
            'transcribe',
            started,
            new AppError(tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST', {
              message: tooLarge ? 'Запись больше 10 МиБ' : 'Некорректная форма запроса',
            }),
          );
          return;
        }
        send(res, null, 'transcribe', started, new AppError('INVALID_REQUEST'));
      });
    },
    async (req: Request, res: Response) => {
      const started = Date.now();
      const requestId = pickRequestId(req.body);
      try {
        const fields = TranscribeFieldsSchema.parse({ ...(req.body as object) });
        const file = req.file;
        if (config.mode === 'live') {
          if (!file || file.size === 0) throw new AppError('NO_SPEECH', { message: 'Запись пуста' });
          if (!SUPPORTED_AUDIO_TYPES.includes(baseMimeType(file.mimetype) as (typeof SUPPORTED_AUDIO_TYPES)[number])) {
            throw new AppError('UNSUPPORTED_AUDIO', { message: `Формат ${baseMimeType(file.mimetype)} не поддерживается` });
          }
        }
        const budget = createBudget(config.providerTimeoutMs, clientSignal(res));
        let attempts = 0;
        const result = await callWithBudget(
          budget,
          (signal) =>
            providers.transcriber.transcribe({
              audio: file?.buffer ?? null,
              mimeType: file?.mimetype ?? null,
              scenarioId: fields.scenarioId,
              questionId: fields.questionId,
              unitId: fields.unitId,
              signal,
            }),
          { onAttempt: () => (attempts += 1) },
        );
        const body: TranscribeResponse = {
          schemaVersion: SCHEMA_VERSION,
          requestId: fields.requestId,
          sessionRevision: fields.sessionRevision,
          answerId: fields.answerId,
          text: result.text,
          language: result.language,
          source: providers.transcriber.source,
        };
        logger.log({
          requestId: fields.requestId,
          route: 'transcribe',
          stage: 'done',
          mode: config.mode,
          model: providers.transcriber.model,
          durationMs: Date.now() - started,
          attempts,
        });
        res.json(body);
      } catch (error) {
        send(res, requestId, 'transcribe', started, error);
      }
      // Буфер аудио больше не нужен: освобождаем ссылку.
      if (req.file) (req.file as { buffer?: Buffer }).buffer = undefined;
    },
  );

  const json = express.json({ limit: LIMITS.maxJsonBodyBytes, strict: true });
  const jsonErrors = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!err) return next();
    const type = (err as { type?: string }).type;
    const appError =
      type === 'entity.too.large'
        ? new AppError('PAYLOAD_TOO_LARGE', { message: 'Тело запроса больше 256 КиБ' })
        : new AppError('INVALID_REQUEST', { message: 'Тело запроса не является корректным JSON' });
    send(res, null, 'json', Date.now(), appError);
  };

  // ---------- POST /api/analyze ----------
  app.post('/api/analyze', json, jsonErrors, async (req: Request, res: Response) => {
    const started = Date.now();
    const requestId = pickRequestId(req.body);
    try {
      rateLimit(req);
      const input = AnalyzeRequestSchema.parse(req.body);
      const budget = createBudget(config.providerTimeoutMs, clientSignal(res));
      const result = await runAnalysis({
        snapshot: input.snapshot,
        previousFacts: input.previousFacts,
        analyzer: providers.analyzer,
        budget,
      });
      const body: AnalyzeResponse = {
        schemaVersion: SCHEMA_VERSION,
        requestId: input.requestId,
        sessionRevision: input.snapshot.sessionRevision,
        analysis: result.analysis,
        completeness: result.completeness,
        questionStatuses: result.questionStatuses,
        source: providers.analyzer.source,
      };
      logger.log({
        requestId: input.requestId,
        route: 'analyze',
        stage: 'done',
        mode: config.mode,
        model: providers.analyzer.model,
        promptVersion: providers.analyzer.promptVersion,
        durationMs: Date.now() - started,
        attempts: result.meta.attempts,
        detail: result.meta.repaired ? 'repaired' : undefined,
      });
      res.json(body);
    } catch (error) {
      send(res, requestId, 'analyze', started, error);
    }
  });

  // ---------- POST /api/generate ----------
  app.post('/api/generate', json, jsonErrors, async (req: Request, res: Response) => {
    const started = Date.now();
    const requestId = pickRequestId(req.body);
    try {
      rateLimit(req);
      const input = GenerateRequestSchema.parse(req.body);
      const budget = createBudget(config.providerTimeoutMs, clientSignal(res));
      const result = await runGeneration({
        snapshot: input.snapshot,
        analysis: input.analysis,
        confirmedFactIds: input.confirmedFactIds,
        generator: providers.generator,
        budget,
      });
      const body: GenerateResponse = {
        schemaVersion: SCHEMA_VERSION,
        requestId: input.requestId,
        sessionRevision: input.snapshot.sessionRevision,
        document: result.document,
        source: providers.generator.source,
      };
      logger.log({
        requestId: input.requestId,
        route: 'generate',
        stage: 'done',
        mode: config.mode,
        model: providers.generator.model,
        promptVersion: providers.generator.promptVersion,
        durationMs: Date.now() - started,
        attempts: result.meta.attempts,
        detail: result.meta.repaired ? 'repaired' : undefined,
      });
      res.json(body);
    } catch (error) {
      send(res, requestId, 'generate', started, error);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json(errorBody(null, new AppError('NOT_FOUND')));
  });

  // ---------- Клиент (production) ----------
  if (config.clientDir) {
    const clientDir = config.clientDir;
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      next();
    });
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  // Последний обработчик: непредвиденная ошибка.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    send(res, null, 'unhandled', Date.now(), err);
  });

  return app;
}
