/**
 * Обзор: четыре карточки, полнота, пропуски, источники фактов, переход к исправлению
 * и создание описания (docs/02-ux.md, S06).
 */
import { Accordion, AccordionItem, Button, Column, Grid, InlineNotification, Tag } from '@carbon/react';
import { ArrowLeft, DocumentAdd, Edit } from '@carbon/icons-react';
import { useMemo } from 'react';
import { evaluateFacts, usableFacts } from '../../shared/completeness';
import { QUESTIONS, QUESTION_IDS, UNIT_LABELS, type QuestionId } from '../../shared/constants';
import { validateAnalysisRelations } from '../../shared/validation';
import { ActionErrorNotice, EmptyState, GlassPanel, SectionBoundary, SlowNotice, useDerived, useFocusOnChange } from '../components/common';
import { SessionRing } from '../components/SessionRing';
import { useActions, useSession } from '../state/store';
import { factsInView, hasDirtyDrafts, isDocumentStale, unitLabelReason } from '../state/transitions';

const STATUS_TEXT = { empty: 'Нет сведений', partial: 'Частично', complete: 'Полностью' } as const;
const STATUS_TAG = { empty: 'gray', partial: 'warm-gray', complete: 'green' } as const;

export function OverviewScreen() {
  const s = useSession();
  const actions = useActions();
  const { units, statuses, completeness } = useDerived(s);
  const usable = useMemo(() => usableFacts(s.analysis, s.answers, s.confirmedFactIds), [s.analysis, s.answers, s.confirmedFactIds]);
  const evals = useMemo(() => evaluateFacts(s.analysis, s.answers, s.confirmedFactIds), [s.analysis, s.answers, s.confirmedFactIds]);
  const headingRef = useFocusOnChange<HTMLHeadingElement>(s.screen);
  const activeAnswers = s.answers.filter((a) => a.active);
  const analysisMismatch = s.analysis ? validateAnalysisRelations(s.analysis, activeAnswers).length > 0 : false;
  const dirty = QUESTION_IDS.some((q) => hasDirtyDrafts(s, q));
  const generating = s.request?.op === 'generate';
  const blockedReason =
    usable.length === 0
      ? null
      : analysisMismatch
        ? 'Ответы изменились после проверки. Откройте изменённый вопрос и нажмите «Проверить ответ».'
        : dirty
          ? 'Есть непроверенные правки ответов. Проверьте их или отмените.'
          : null;
  const error = s.error && (s.error.op === 'generate' || s.error.questionId === null) ? s.error : null;
  const firstEmpty = Math.max(0, QUESTION_IDS.findIndex((q) => statuses[q] !== 'complete'));

  return (
    <Grid className="split-grid" condensed={false}>
      <Column sm={4} md={8} lg={16} xlg={10} max={10} className="split-grid__main">
        <GlassPanel className="overview-panel" labelledBy="overview-title">
          <h1 id="overview-title" className="panel-title" ref={headingRef} tabIndex={-1}>
            Обзор ответов
          </h1>
          <p className="panel-lead">Проверьте сведения по четырём вопросам. Источник каждого факта можно раскрыть.</p>
          <SectionBoundary name="Обзор">
            <div className="overview-cards">
              {QUESTION_IDS.map((q) => (
                <QuestionCard
                  key={q}
                  q={q}
                  status={statuses[q]}
                  answered={s.answered[q]}
                  onEdit={() => actions.goToQuestion(QUESTIONS[q].index)}
                  units={units.filter((u) => u.questionId === q)}
                  evals={evals}
                />
              ))}
            </div>
            {statuses[QUESTION_IDS[firstEmpty]!] !== 'complete' ? (
              <Button className="overview-return" kind="tertiary" size="md" renderIcon={Edit} onClick={() => actions.goToQuestion(firstEmpty)}>
                Вернуться к вопросу с пробелами
              </Button>
            ) : null}
          </SectionBoundary>
        </GlassPanel>
      </Column>
      <Column sm={4} md={8} lg={16} xlg={6} max={6} className="split-grid__side">
        <GlassPanel as="aside" className="side-panel" labelledBy="overview-side-title">
          <h2 id="overview-side-title" className="cds--visually-hidden">
            Полнота и создание описания
          </h2>
          <SessionRing />
          {error ? <ActionErrorNotice error={error} /> : null}
          <SlowNotice />
          {usable.length === 0 ? (
            <EmptyState stateId="S06" title="Пока недостаточно данных для описания">
              <p>Подтвердите хотя бы один факт. Генерация недоступна, пока нет подтверждённых сведений.</p>
              <Button kind="primary" size="lg" renderIcon={Edit} onClick={() => actions.goToQuestion(firstEmpty)}>
                Добавить ответ
              </Button>
            </EmptyState>
          ) : (
            <div className="generate-box">
              {completeness < 100 ? <p className="generate-box__gaps">В описании останутся пропуски.</p> : null}
              {blockedReason ? <InlineNotification kind="info" lowContrast hideCloseButton title="Описание пока нельзя создать" subtitle={blockedReason} /> : null}
              <Button
                kind="primary"
                size="lg"
                renderIcon={DocumentAdd}
                disabled={Boolean(blockedReason) || Boolean(s.request)}
                onClick={() => void actions.generate()}
              >
                {s.document ? 'Обновить описание' : 'Создать описание'}
              </Button>
              {generating ? (
                <Button kind="ghost" size="md" onClick={() => actions.cancelRequest()}>
                  Отменить
                </Button>
              ) : null}
              {s.document && !generating ? (
                <Button kind="tertiary" size="lg" onClick={() => actions.openResult()}>
                  {isDocumentStale(s) ? 'Открыть прежнее описание' : 'Открыть описание'}
                </Button>
              ) : null}
              <p className="generate-box__note">
                В описание попадут только подтверждённые факты ({usable.length}). Должность, зарплата и условия не добавляются, если вы их не назвали.
              </p>
            </div>
          )}
          <Button kind="ghost" size="md" renderIcon={ArrowLeft} disabled={Boolean(s.request && s.request.op !== 'analyze')} onClick={() => actions.back()}>
            К вопросам
          </Button>
        </GlassPanel>
      </Column>
    </Grid>
  );
}

function QuestionCard({ q, status, answered, onEdit, units, evals }: {
  q: QuestionId;
  status: 'empty' | 'partial' | 'complete';
  answered: 'confirmed' | 'skipped' | null;
  onEdit: () => void;
  units: ReturnType<typeof useDerived>['units'];
  evals: ReturnType<typeof evaluateFacts>;
}) {
  const s = useSession();
  const def = QUESTIONS[q];
  const facts = factsInView(s.analysis, s.answers, q).filter((f) => f.questionId === q);
  const confirmed = facts.filter((f) => evals.get(f.id)?.status === 'usable');
  const needsReview = facts.some((f) => {
    const st = evals.get(f.id)?.status;
    return st === 'stale_source' || st === 'dependency' || (st === 'unconfirmed' && answered === 'confirmed');
  });
  const answersById = new Map(s.answers.map((a) => [a.id, a]));
  const missing = units.filter((u) => !u.valid);
  const savedAnswer = s.answers.some((answer) => answer.questionId === q && answer.active);
  const transcribing = s.request?.op === 'transcribe' && s.request.questionId === q;
  const awaitingAnalysis = savedAnswer && s.analysisRevision !== s.sessionRevision && answered !== 'confirmed';
  const inWork = Boolean(transcribing || (awaitingAnalysis && s.request?.op === 'analyze'));
  const workPercent = transcribing ? 25 : 50;
  const needsAnalysis = awaitingAnalysis && !inWork;
  return (
    <article className="overview-card" data-testid={`overview-${q}`} aria-labelledby={`ov-${q}`}>
      <header className="overview-card__head">
        <h2 id={`ov-${q}`} className="overview-card__title">
          {def.index + 1}. {def.shortTitle}
        </h2>
        <Tag type={inWork ? 'blue' : needsAnalysis ? 'warm-gray' : STATUS_TAG[status]} size="sm">
          {inWork ? `В работе · ${workPercent}%` : needsAnalysis ? 'Нужна проверка' : STATUS_TEXT[status]}
        </Tag>
        {!inWork && !needsAnalysis ? (
          <Tag type={answered ? 'cool-gray' : 'outline'} size="sm">
            {answered === 'confirmed' ? 'Проверен' : answered === 'skipped' ? 'Пропущен' : 'Не проверен'}
          </Tag>
        ) : null}
      </header>
      <p className="overview-card__question">{def.text}</p>
      {inWork ? (
        <p className="overview-card__empty" role="status">
          {transcribing ? 'Запись получена, речь распознаётся. 25% означает завершение записи.' : 'Текст ответа сохранён, идёт анализ. 50% означает завершение ввода и распознавания.'}
        </p>
      ) : needsAnalysis ? (
        <p className="overview-card__empty">Ответ сохранён. Проверка не завершена. Откройте вопрос и запустите её снова.</p>
      ) : confirmed.length > 0 ? (
        <Accordion size="md" className="overview-card__facts">
          {confirmed.map((f) => (
            <AccordionItem key={f.id} title={f.text}>
              <div className="source-box">
                <p className="source-box__label">Источник</p>
                {f.evidence.map((e, i) => {
                  const a = answersById.get(e.answerId);
                  return (
                    <p key={i} className="source-box__quote">
                      «{e.quote}»{' '}
                      <span className="source-box__meta">
                        — {a?.kind === 'clarification' ? 'уточнение' : 'ответ'}, версия {e.answerRevision}
                        {a?.origin === 'fixture' ? ', тестовый сценарий' : ''}
                      </span>
                    </p>
                  );
                })}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <p className="overview-card__empty">Подтверждённых сведений нет.</p>
      )}
      {!inWork && !needsAnalysis && missing.length > 0 ? (
        <ul className="overview-card__missing">
          {missing.map((u) => (
            <li key={u.id}>
              {UNIT_LABELS[u.id]}: {unitLabelReason(u).toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
      {needsReview ? <p className="overview-card__review">Ответ изменился или связан с изменённым ответом. Требуется проверка.</p> : null}
      <Button kind="tertiary" size="md" renderIcon={Edit} onClick={onEdit}>
        {inWork || needsAnalysis ? 'Открыть вопрос' : 'Исправить'}
      </Button>
    </article>
  );
}
