/**
 * Редактируемая модель документа и Markdown-экспорт (docs/06-generation.md).
 * Экспорт строится из текущего текста редактора.
 */
import {
  EMPTY_SECTION_TEXT,
  GAPS_TITLE,
  SECTION_IDS,
  SECTION_TITLES,
  type SectionId,
} from './constants';
import type { VacancyDocument } from './schemas';

export interface EditableItem {
  key: string;
  text: string;
  sourceFactIds: string[];
}

export interface EditableSection {
  id: SectionId;
  items: EditableItem[];
}

export interface EditableDocument {
  title: string;
  titleSourceFactIds: string[];
  sections: EditableSection[];
  gaps: string[];
}

export function toEditable(document: VacancyDocument): EditableDocument {
  return {
    title: document.title.text,
    titleSourceFactIds: [...document.title.sourceFactIds],
    sections: SECTION_IDS.map((id) => {
      const section = document.sections.find((s) => s.id === id);
      return {
        id,
        items: (section?.items ?? []).map((item, i) => ({
          key: `${id}-${i}`,
          text: item.text,
          sourceFactIds: [...item.sourceFactIds],
        })),
      };
    }),
    gaps: [...document.gaps],
  };
}

/** Однострочный безопасный текст: без переводов строк и HTML-тегов в Markdown. */
function inline(text: string): string {
  return text.replace(/\s*\n+\s*/gu, ' ').replace(/</gu, '\\<').trim();
}

export function documentToMarkdown(doc: EditableDocument): string {
  const lines: string[] = [`# ${inline(doc.title) || 'Описание вакансии'}`, ''];
  for (const section of doc.sections) {
    lines.push(`## ${SECTION_TITLES[section.id]}`, '');
    const items = section.items.map((i) => inline(i.text)).filter((t) => t.length > 0);
    if (items.length === 0) lines.push(EMPTY_SECTION_TEXT);
    else for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
  const gaps = doc.gaps.map(inline).filter((g) => g.length > 0);
  if (gaps.length > 0) {
    lines.push(`## ${GAPS_TITLE}`, '');
    for (const gap of gaps) lines.push(`- ${gap}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function editableEquals(a: EditableDocument, b: EditableDocument): boolean {
  return documentToMarkdown(a) === documentToMarkdown(b);
}
