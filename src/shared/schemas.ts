/**
 * Zod-схемы ответов моделей и HTTP API. Схемы моделей повторяют
 * contracts/*.schema.json; связи между объектами проверяются в validation.ts.
 */
import { z } from 'zod';
import {
  ERROR_CODES,
  FACT_KINDS,
  LIMITS,
  QUESTION_IDS,
  SCHEMA_VERSION,
  SECTION_IDS,
  UNIT_IDS,
  UNIT_STATES,
} from './constants';

export const QuestionIdSchema = z.enum(QUESTION_IDS);
export const UnitIdSchema = z.enum(UNIT_IDS);
export const FactKindSchema = z.enum(FACT_KINDS);
export const UnitStateSchema = z.enum(UNIT_STATES);

const shortId = z.string().min(1).max(64);

// ---------- analysis.schema.json ----------

export const EvidenceSchema = z.strictObject({
  answerId: shortId,
  answerRevision: z.number().int().min(1),
  quote: z.string().min(1).max(LIMITS.maxAnswerChars),
});

export const FactSchema = z.strictObject({
  id: shortId,
  questionId: QuestionIdSchema,
  kind: FactKindSchema,
  text: z.string().trim().min(1).max(600),
  evidence: z.array(EvidenceSchema).min(1).max(8),
  dependsOn: z.array(shortId).max(8),
});

export const UnitSchema = z.strictObject({
  id: UnitIdSchema,
  state: UnitStateSchema,
  factIds: z.array(shortId).max(16),
});

export const ConflictSchema = z.strictObject({
  factIds: z.array(shortId).min(1).max(8),
  description: z.string().max(600),
});

export const AnalysisSchema = z.strictObject({
  facts: z.array(FactSchema).max(48),
  units: z.array(UnitSchema).length(8),
  conflicts: z.array(ConflictSchema).max(16),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

// ---------- vacancy.schema.json ----------

export const DocumentItemSchema = z.strictObject({
  text: z.string().trim().min(1).max(1000),
  sourceFactIds: z.array(shortId).min(1).max(16),
});

export const DocumentSectionSchema = z.strictObject({
  id: z.enum(SECTION_IDS),
  items: z.array(DocumentItemSchema).max(20),
});

export const VacancyDocumentSchema = z.strictObject({
  title: z.strictObject({
    text: z.string().trim().min(1).max(200),
    sourceFactIds: z.array(shortId).max(8),
  }),
  sections: z.array(DocumentSectionSchema).length(5),
  gaps: z.array(z.string().max(300)).max(20),
});

export type DocumentItem = z.infer<typeof DocumentItemSchema>;
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
export type VacancyDocument = z.infer<typeof VacancyDocumentSchema>;

// ---------- HTTP ----------

export const RequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'requestId: 8–64 символа [A-Za-z0-9_-]');
export const AnswerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const AnswerSchema = z.strictObject({
  id: AnswerIdSchema,
  questionId: QuestionIdSchema,
  revision: z.number().int().min(1),
  text: z.string().max(LIMITS.maxAnswerChars, `Ответ длиннее ${LIMITS.maxAnswerChars} символов`),
  active: z.boolean(),
});
export type AnswerPayload = z.infer<typeof AnswerSchema>;

export const SnapshotSchema = z
  .strictObject({
    sessionRevision: z.number().int().min(0),
    answers: z.array(AnswerSchema).max(48),
    confirmedFactIds: z.array(shortId).max(96),
  })
  .superRefine((snapshot, ctx) => {
    const active = snapshot.answers.filter((a) => a.active);
    if (active.length > LIMITS.maxActiveAnswers) {
      ctx.addIssue({ code: 'custom', message: `Больше ${LIMITS.maxActiveAnswers} активных ответов` });
    }
    const chars = active.reduce((sum, a) => sum + a.text.length, 0);
    if (chars > LIMITS.maxSessionChars) {
      ctx.addIssue({ code: 'custom', message: `Ответы длиннее ${LIMITS.maxSessionChars} символов` });
    }
    const ids = new Set<string>();
    for (const a of snapshot.answers) {
      if (ids.has(a.id)) ctx.addIssue({ code: 'custom', message: `Повтор answerId ${a.id}` });
      ids.add(a.id);
    }
  });
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const AnalyzeRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  snapshot: SnapshotSchema,
  /**
   * Расширение контракта: факты прошлого анализа. Только подсказка формулировок
   * для live-модели; сервер их не доверяет и заново проверяет весь результат.
   */
  previousFacts: z.array(FactSchema).max(48).optional(),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const QuestionStatusSchema = z.enum(['empty', 'partial', 'complete']);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const ResultSourceSchema = z.enum(['fixture', 'provider', 'local_template']);
export type ResultSource = z.infer<typeof ResultSourceSchema>;

export const AnalyzeResponseSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  requestId: RequestIdSchema,
  sessionRevision: z.number().int().min(0),
  analysis: AnalysisSchema,
  completeness: z.number().min(0).max(100),
  questionStatuses: z.record(QuestionIdSchema, QuestionStatusSchema),
  source: ResultSourceSchema,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const GenerateRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  snapshot: SnapshotSchema,
  analysis: AnalysisSchema,
  confirmedFactIds: z.array(shortId).max(96),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const GenerateResponseSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  requestId: RequestIdSchema,
  sessionRevision: z.number().int().min(0),
  document: VacancyDocumentSchema,
  source: ResultSourceSchema,
});
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

export const TranscribeFieldsSchema = z.strictObject({
  requestId: RequestIdSchema,
  sessionRevision: z.coerce.number().int().min(0),
  answerId: AnswerIdSchema,
  /** Только demo: какой ответ сценария вернуть. */
  scenarioId: z.string().max(64).optional(),
  questionId: QuestionIdSchema.optional(),
  unitId: UnitIdSchema.optional(),
});

export const TranscribeResponseSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  requestId: RequestIdSchema,
  sessionRevision: z.number().int().min(0),
  answerId: AnswerIdSchema,
  text: z.string(),
  language: z.string(),
  source: ResultSourceSchema,
});
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;

export const DemoScenarioSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  answers: z.record(QuestionIdSchema, z.string()),
});
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const ConfigResponseSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  mode: z.enum(['demo', 'live']),
  limits: z.strictObject({
    maxRecordingSeconds: z.number(),
    maxAudioBytes: z.number(),
    maxAnswerChars: z.number(),
    maxActiveAnswers: z.number(),
    maxSessionChars: z.number(),
    maxClarificationsPerQuestion: z.number(),
  }),
  live: z
    .strictObject({
      sttProvider: z.enum(['whisper', 'deepgram']).optional(),
      sttConfigured: z.boolean(),
      llmProvider: z.enum(['ollama', 'anthropic']).optional(),
      llmConfigured: z.boolean(),
      sttModel: z.string(),
      sttLanguage: z.string(),
      llmModel: z.string().nullable(),
    })
    .optional(),
  demo: z
    .strictObject({
      scenarios: z.array(DemoScenarioSchema),
      catalog: z.record(QuestionIdSchema, z.array(z.string())),
    })
    .optional(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export const ErrorResponseSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  requestId: z.string().nullable(),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
