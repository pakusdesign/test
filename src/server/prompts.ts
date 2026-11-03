/**
 * Системные промпты для live. Текст ответов в system не вставляется:
 * snapshot передаётся отдельным пользовательским сообщением (prompts/extract.md).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import analysisSchema from '../../contracts/analysis.schema.json' with { type: 'json' };
import vacancySchema from '../../contracts/vacancy.schema.json' with { type: 'json' };

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Structured outputs Anthropic не поддерживают minLength, minimum, maxItems и
 * minItems > 1 (https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
 * Удаляем эти ограничения из схемы для модели; исходные проверяет Zod на сервере.
 */
export function toProviderSchema(schema: JsonValue): JsonValue {
  if (Array.isArray(schema)) return schema.map(toProviderSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['$schema', 'title', 'minLength', 'maxLength', 'minimum', 'maximum', 'maxItems', 'multipleOf'].includes(key)) continue;
    if (key === 'minItems' && typeof value === 'number' && value > 1) continue;
    out[key] = toProviderSchema(value);
  }
  return out;
}

export const PROVIDER_ANALYSIS_SCHEMA = toProviderSchema(analysisSchema as JsonValue);
export const PROVIDER_VACANCY_SCHEMA = toProviderSchema(vacancySchema as JsonValue);

export interface PromptSet {
  extractSystem: string;
  generateSystem: string;
}

/** Берёт раздел промпта до «# Сборка запроса» — это инструкции для сборщика, а не для модели. */
function modelPart(markdown: string): string {
  const idx = markdown.indexOf('# Сборка запроса');
  return (idx >= 0 ? markdown.slice(0, idx) : markdown).trim();
}

export function loadPrompts(rootDir: string): PromptSet {
  const read = (rel: string) => readFileSync(path.join(rootDir, rel), 'utf8');
  const extract = modelPart(read('prompts/extract.md'));
  const generate = modelPart(read('prompts/generate.md'));
  const rubric = read('docs/03-semantics.md');
  return {
    extractSystem: [
      extract,
      '# Рубрика полноты (docs/03-semantics.md)',
      rubric,
      '# Формат ответа',
      'Ответ проходит проверку по JSON Schema:',
      JSON.stringify(analysisSchema),
      'Ровно восемь элементов units. Каждая цитата — дословный фрагмент текста ответа с указанным answerId и revision.',
    ].join('\n\n'),
    generateSystem: [
      generate,
      '# Формат ответа',
      'Ответ проходит проверку по JSON Schema:',
      JSON.stringify(vacancySchema),
      'Ровно пять разделов в порядке: daily_tasks, current_project, next_six_months, tools, knowledge.',
    ].join('\n\n'),
  };
}
