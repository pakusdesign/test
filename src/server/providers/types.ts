import type { QuestionId, UnitId } from '../../shared/constants';
import type { AnswerRef } from '../../shared/completeness';
import type { Fact, ResultSource } from '../../shared/schemas';

export interface TranscribeInput {
  audio: Buffer | null;
  mimeType: string | null;
  scenarioId?: string;
  questionId?: QuestionId;
  unitId?: UnitId;
  signal: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  language: string;
}

export interface Transcriber {
  readonly source: ResultSource;
  readonly model: string | null;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export interface RepairRequest {
  previousOutput: string;
  issues: string[];
}

export interface AnalyzerInput {
  answers: AnswerRef[];
  sessionRevision: number;
  previousFacts?: Fact[];
  repair?: RepairRequest;
  signal: AbortSignal;
}

export interface ModelOutput {
  raw: unknown;
  /** Исходный текст ответа модели — только для repair-вызова, не для логов. */
  rawText: string;
}

export interface Analyzer {
  readonly source: ResultSource;
  readonly model: string | null;
  readonly promptVersion: string;
  analyze(input: AnalyzerInput): Promise<ModelOutput>;
}

export interface GeneratorInput {
  facts: Fact[];
  gaps: string[];
  sessionRevision: number;
  repair?: RepairRequest;
  signal: AbortSignal;
}

export interface Generator {
  readonly source: ResultSource;
  readonly model: string | null;
  readonly promptVersion: string;
  generate(input: GeneratorInput): Promise<ModelOutput>;
}

export interface Providers {
  transcriber: Transcriber;
  analyzer: Analyzer;
  generator: Generator;
}
