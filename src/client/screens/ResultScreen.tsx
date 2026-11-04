/**
 * Результат: заголовок, пять разделов, «Нужно уточнить», редактор, копирование
 * и скачивание Markdown (docs/06-generation.md). Текст выводится как текст, без HTML.
 */
import { Accordion, AccordionItem, Button, Column, Grid, IconButton, InlineNotification, SkeletonText, Tag, TextArea, TextInput } from '@carbon/react';
import { ArrowLeft, Copy, Download, Renew, TrashCan } from '@carbon/icons-react';
import { useEffect, useMemo, useRef } from 'react';
import { EMPTY_SECTION_TEXT, GAPS_TITLE, SECTION_QUESTION, SECTION_TITLES } from '../../shared/constants';
import { documentToMarkdown } from '../../shared/markdown';
import { ActionErrorNotice, EmptyState, GlassPanel, SectionBoundary, SlowNotice, useDerived, useFocusOnChange } from '../components/common';
import { modeOf } from '../components/demo';
import { SessionRing } from '../components/SessionRing';
import { useActions, useSession } from '../state/store';
import { isDocumentStale } from '../state/transitions';
import { QUESTIONS } from '../../shared/constants';

export function ResultScreen() {
  const s = useSession();
  const actions = useActions();
  const doc = s.document;
  const { completeness } = useDerived(s);
  const headingRef = useFocusOnChange<HTMLHeadingElement>(s.screen);
  const stale = isDocumentStale(s);
  const markdown = useMemo(() => (doc ? documentToMarkdown(doc.edited) : ''), [doc]);
  const exportRef = useRef<HTMLDivElement>(null);
  const generating = s.request?.op === 'generate';
  const factsById = useMemo(() => new Map((s.analysis?.facts ?? []).map((f) => [f.id, f])), [s.analysis]);

  // S23: «Выделить текст» — выделение Markdown для ручного копирования.
  useEffect(() => {
    if (s.selectExport === 0) return;
    const area = exportRef.current?.querySelector('textarea');
    if (area) {
      area.focus();
      area.select();
    }
  }, [s.selectExport]);

  const error = s.error && (s.error.op === 'generate' || s.error.op === 'copy') ? s.error : null;

  if (!doc) {
    return (
      <GlassPanel className="result-panel">
        {generating ? (
          <div role="status">
            <SessionRing />
            <SkeletonText paragraph lineCount={6} />
          </div>
        ) : (
          <EmptyState stateId="S06" title="Описание ещё не создано">
            <Button kind="primary" onClick={() => actions.openOverview()}>
              К обзору
            </Button>
          </EmptyState>
        )}
      </GlassPanel>
    );
  }

  const partial = completeness < 100;
  return (
    <Grid className="split-grid" condensed={false}>
      <Column sm={4} md={8} lg={16} xlg={10} max={10} className="split-grid__main">
        <GlassPanel className="result-panel" labelledBy="result-title">
          <div className="result-panel__head">
            <h1 id="result-title" className="panel-title" ref={headingRef} tabIndex={-1}>
              Описание вакансии
            </h1>
            <div className="result-panel__tags">
              {doc.source === 'fixture' ? (
                <Tag type="purple" size="sm">
                  Демо: шаблон без AI
                </Tag>
              ) : doc.source === 'local_template' ? (
                <Tag type="teal" size="sm">Собрано по подтверждённым фактам</Tag>
              ) : (
                <Tag type="blue" size="sm">
                  Создано моделью
                </Tag>
              )}
              {doc.isManuallyEdited ? (
                <Tag type="magenta" size="sm">
                  Изменено вручную
                </Tag>
              ) : null}
              {partial ? (
                <Tag type="warm-gray" size="sm">
                  Черновик с пропусками
                </Tag>
              ) : null}
            </div>
          </div>
          {stale ? (
            <div data-state-id="S22" className="stale-box">
              <InlineNotification
                kind="warning"
                lowContrast
                hideCloseButton
                title="Ответы изменились. Обновите описание"
                subtitle="Текущий текст сохранён. Экспорт устаревшего текста потребует подтверждения."
              />
              <Button kind="primary" size="md" renderIcon={Renew} disabled={Boolean(s.request)} onClick={() => void actions.generate()}>
                Обновить описание
              </Button>
            </div>
          ) : null}
          {doc.isManuallyEdited ? (
            <p className="result-panel__edited-note">Текст изменён вручную. Изменённые пункты не сверяются с источниками.</p>
          ) : null}
          <SectionBoundary name="Описание">
            <div className="doc-editor">
              <TextInput
                id="doc-title"
                labelText="Заголовок"
                value={doc.edited.title}
                onChange={(e) => actions.editTitle(e.target.value)}
              />
              {doc.edited.sections.map((section) => (
                <section key={section.id} className="doc-section" aria-labelledby={`sec-${section.id}`} data-testid={`section-${section.id}`}>
                  <h2 id={`sec-${section.id}`} className="doc-section__title">
                    {SECTION_TITLES[section.id]}
                  </h2>
                  {section.items.length === 0 ? (
                    <div className="doc-section__empty" data-state-id="S07">
                      <p>{EMPTY_SECTION_TEXT}</p>
                      <Button size="sm" kind="ghost" onClick={() => actions.goToQuestion(QUESTIONS[SECTION_QUESTION[section.id]].index)}>
                        Дополнить ответы
                      </Button>
                    </div>
                  ) : (
                    <ul className="doc-items">
                      {section.items.map((item, i) => (
                        <li key={item.key} className="doc-item">
                          <TextArea
                            id={`item-${item.key}`}
                            labelText={`${SECTION_TITLES[section.id]}, пункт ${i + 1}`}
                            hideLabel
                            rows={2}
                            value={item.text}
                            onChange={(e) => actions.editItem(section.id, item.key, e.target.value)}
                          />
                          <IconButton
                            kind="ghost"
                            size="md"
                            label="Удалить пункт"
                            align="left"
                            onClick={() => actions.removeItem(section.id, item.key)}
                          >
                            <TrashCan />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
              <section className="doc-gaps" aria-labelledby="gaps-title">
                <h2 id="gaps-title" className="doc-section__title">
                  {GAPS_TITLE}
                </h2>
                <p className="doc-gaps__note">Этот блок не является частью утверждений о вакансии.</p>
                {doc.edited.gaps.length === 0 ? (
                  <p data-state-id="S08">По четырём вопросам данных достаточно.</p>
                ) : (
                  <ul className="doc-gaps__list">
                    {doc.edited.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </SectionBoundary>
        </GlassPanel>
      </Column>
      <Column sm={4} md={8} lg={16} xlg={6} max={6} className="split-grid__side">
        <GlassPanel as="aside" className="side-panel" labelledBy="export-title">
          <SessionRing />
          {error ? <ActionErrorNotice error={error} /> : null}
          <SlowNotice />
          <h2 id="export-title" className="side-panel__title">
            Экспорт
          </h2>
          <div className="answer-actions">
            <Button kind="primary" size="lg" renderIcon={Copy} onClick={() => void actions.copy()}>
              Копировать
            </Button>
            <Button kind="tertiary" size="lg" renderIcon={Download} onClick={() => actions.download()}>
              Скачать .md
            </Button>
          </div>
          <div className="export-preview" ref={exportRef}>
            <TextArea id="export-markdown" labelText="Markdown для копирования" readOnly rows={8} value={markdown} />
          </div>
          <Accordion size="md" className="sources-accordion">
            <AccordionItem title="Источники пунктов">
              <ul className="sources-list">
                {doc.edited.sections.flatMap((section) =>
                  section.items.map((item) => (
                    <li key={item.key}>
                      <span className="sources-list__item">{SECTION_TITLES[section.id]}: {item.text}</span>
                      {item.sourceFactIds.map((id) => {
                        const f = factsById.get(id);
                        return f ? (
                          <span key={id} className="sources-list__quote">
                            «{f.evidence[0]?.quote}»
                          </span>
                        ) : null;
                      })}
                    </li>
                  )),
                )}
              </ul>
            </AccordionItem>
          </Accordion>
          <div className="side-panel__nav">
            <Button kind="ghost" size="md" renderIcon={ArrowLeft} onClick={() => actions.openOverview()}>
              К обзору
            </Button>
            {!stale ? (
              <Button kind="ghost" size="md" renderIcon={Renew} disabled={Boolean(s.request)} onClick={() => void actions.generate()}>
                Создать заново
              </Button>
            ) : null}
          </div>
          {modeOf(s) === 'demo' ? <p className="demo-hint">Демонстрация: описание собрано шаблоном. Текст пунктов совпадает с подтверждёнными фактами.</p> : null}
        </GlassPanel>
      </Column>
    </Grid>
  );
}
