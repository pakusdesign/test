/**
 * Сеть и ошибки сервиса (T15–T17, T30–T32, N01–N09, S15, S17–S20, S23, S24, S26).
 * Потеря сети браузером (context.setOffline) проверяется отдельно от отказа сервиса
 * при navigator.onLine === true (page.route).
 */
import { expect, test, type Page } from '@playwright/test';
import { FULL, answerWithText, confirm, expectPercent, open, submitText } from './helpers';

const errorBody = (code: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: '1.0', requestId: null, error: { code, message: 'x', retryable: true, ...extra } });

async function countRequests(page: Page, path: string) {
  const counter = { n: 0 };
  page.on('request', (r) => {
    if (r.url().endsWith(path)) counter.n += 1;
  });
  return counter;
}

test('T30 / N02 → N03 → N07 → N08: сеть пропала во время записи и отправки, ручной повтор без дубля', async ({ page, context }) => {
  await open(page);
  const transcribe = await countRequests(page, '/api/transcribe');
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator('[data-state-id="N02"]')).toContainText('Запись продолжается в этой вкладке');
  // Микрофон не перезапускается и не останавливается сетевым событием.
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Завершить запись' }).click();
  await expect(page.getByTestId('recorded-panel').locator('audio')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Подставить ответ сценария' }).click();
  await expect(page.locator('[data-state-id="N03"]')).toContainText('Не удалось отправить запись');
  await expect(page.locator('[data-state-id="N03"]')).toContainText('Она остаётся в этой вкладке');
  await expect(page.getByTestId('recorded-panel').locator('audio')).toHaveAttribute('src', /^blob:/);
  // Ошибка записи уже показана рядом с ответом: общий баннер не дублирует её.
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);
  await expectPercent(page, 0);

  // N07: восстановление — только подсказка, автоматического запроса нет.
  const before = transcribe.n;
  await context.setOffline(false);
  const banner = page.locator('[data-state-id="N07"]');
  await expect(banner).toContainText('Соединение могло восстановиться');
  await page.waitForTimeout(500);
  expect(transcribe.n).toBe(before);
  await banner.getByRole('button', { name: 'Повторить' }).click();
  // N08: ошибка снята, один ответ.
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('answer-card')).toHaveCount(1);
  await expect(page.locator('[data-state-id="N03"]')).toHaveCount(0);
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);
});

test('N04 / T31: ответ анализа не получен — текст сохранён, повтор с новым requestId не создаёт Answer', async ({ page }) => {
  await open(page, 'full');
  const ids: string[] = [];
  let fail = true;
  await page.route('**/api/analyze', async (route) => {
    ids.push(JSON.parse(route.request().postData() ?? '{}').requestId);
    if (fail) {
      fail = false;
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  const err = page.locator('[data-state-id="N04"]');
  await expect(err).toContainText('Не удалось получить ответ сервиса');
  await expect(page.getByTestId('answer-card').locator('textarea')).toHaveValue(FULL.q1);
  await err.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByTestId('fact')).toHaveCount(2);
  await expect(page.getByTestId('answer-card')).toHaveCount(1);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
});

test('T32 / S18: отказ сервиса при navigator.onLine=true не объявляется потерей интернета', async ({ page }) => {
  await open(page, 'full');
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: errorBody('PROVIDER_ERROR') }));
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('[data-state-id="S18"]')).toContainText('Не удалось обработать ответ');
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);
  await expect(page.getByTestId('answer-card').locator('textarea')).toHaveValue(FULL.q1);
  await expectPercent(page, 0);
});

test('T15 / S17, S19: 429 с задержкой и тайм-аут — данные сохранены, без автоповторов', async ({ page }) => {
  await open(page, 'full');
  const analyze = await countRequests(page, '/api/analyze');
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', headers: { 'retry-after': '30' }, body: errorBody('RATE_LIMITED', { retryAfterSeconds: 30 }) }),
  );
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('[data-state-id="S17"]')).toContainText('примерно через 30 с');
  await page.waitForTimeout(800);
  expect(analyze.n).toBe(1);
  await page.unroute('**/api/analyze');
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 504, contentType: 'application/json', body: errorBody('PROVIDER_TIMEOUT') }));
  await page.locator('[data-state-id="S17"]').getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('[data-state-id="S19"]')).toContainText('Сервис не ответил вовремя');
  await expect(page.getByTestId('answer-card')).toHaveCount(1);
});

test('T16 / S20: ответ с чужой цитатой отклоняется клиентом, ложного прогресса нет', async ({ page }) => {
  await open(page, 'full');
  await page.route('**/api/analyze', async (route) => {
    const req = JSON.parse(route.request().postData()!);
    const answer = req.snapshot.answers[0];
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0',
        requestId: req.requestId,
        sessionRevision: req.snapshot.sessionRevision,
        analysis: {
          facts: [{ id: 'f_x', questionId: 'q1', kind: 'task', text: 'Зарплата 500000', evidence: [{ answerId: answer.id, answerRevision: 1, quote: 'зарплата 500000' }], dependsOn: [] }],
          units: ['q1.task1', 'q1.task2', 'q2.project', 'q2.contribution', 'q3.direction', 'q3.project', 'q4.tools', 'q4.knowledge'].map((id) => ({ id, state: id === 'q1.task1' ? 'known' : 'missing', factIds: id === 'q1.task1' ? ['f_x'] : [] })),
          conflicts: [],
        },
        completeness: 12.5,
        questionStatuses: { q1: 'partial', q2: 'empty', q3: 'empty', q4: 'empty' },
        source: 'provider',
      }),
    });
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('[data-state-id="S20"]')).toContainText('Не удалось получить корректный результат');
  await expect(page.getByTestId('fact')).toHaveCount(0);
  await expectPercent(page, 0);
});

test('T17 / S14: отмена обработки; поздний ответ отменённого запроса не применяется', async ({ page }) => {
  await open(page, 'full');
  let calls = 0;
  let releaseFirst: (() => void) | null = null;
  await page.route('**/api/analyze', async (route) => {
    calls += 1;
    if (calls === 1) {
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => undefined);
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('.vpr').first()).toHaveAttribute('data-stage', 'processing');
  await page.getByRole('button', { name: 'Отменить обработку' }).click();
  await expect(page.getByText('Ответ ещё не проверен')).toBeVisible();
  await page.locator('.review__stale').getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.getByTestId('fact')).toHaveCount(2);
  releaseFirst!();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('fact')).toHaveCount(2);
  await expect(page.locator('[data-testid="action-error"]')).toHaveCount(0);
});

test('S15 / N09: обработка дольше 10 секунд — сообщение и отмена', async ({ page }) => {
  await page.clock.install();
  await open(page, 'full');
  await page.route('**/api/analyze', async () => {
    // Ответ не приходит: медленное соединение.
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('.vpr').first()).toHaveAttribute('data-stage', 'processing');
  await page.clock.fastForward(10_500);
  const slow = page.locator('[data-state-id="S15"]');
  await expect(slow).toContainText('Обработка занимает больше времени');
  await page.getByRole('button', { name: 'Отменить обработку' }).click();
  await expect(slow).toHaveCount(0);
  await expect(page.getByTestId('answer-card').locator('textarea')).toHaveValue(FULL.q1);
});

test('N05: сбой сети при генерации — факты сохранены, повтор', async ({ page }) => {
  await open(page, 'full');
  await answerWithText(page, FULL.q1);
  await confirm(page);
  await page.locator('.question-nav__step', { hasText: '4' }).click();
  await page.getByRole('button', { name: /Пропустить и к обзору/ }).click();
  let fail = true;
  await page.route('**/api/generate', async (route) => {
    if (fail) {
      fail = false;
      await route.abort('internetdisconnected');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Создать описание' }).click();
  const err = page.locator('[data-state-id="N05"]');
  await expect(err).toContainText('Не удалось получить описание');
  await expect(err).toContainText('Подтверждённые факты');
  await expectPercent(page, 25);
  await err.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
});

test('N06 / N01: без сети результат редактируется и скачивается; текст ответа можно править', async ({ page, context }) => {
  await open(page, 'full');
  await answerWithText(page, FULL.q1);
  await confirm(page);
  await context.setOffline(true);
  await expect(page.locator('[data-state-id="N01"]')).toContainText('Ответы остаются в этой вкладке');
  await page.getByTestId('answer-card').locator('textarea').fill(FULL.q1 + ' ');
  await expect(page.getByTestId('answer-card').getByRole('button', { name: 'Проверить ответ' })).toBeVisible();
  await page.getByTestId('answer-card').getByRole('button', { name: 'Отменить правку' }).click();
  await context.setOffline(false);
  await page.locator('.question-nav__step', { hasText: '4' }).click();
  await page.getByRole('button', { name: /Пропустить и к обзору/ }).click();
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator('[data-state-id="N06"]')).toContainText('Редактирование, копирование и скачивание работают');
  await page.locator('#doc-title').fill('Черновик без сети');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать .md' }).click()]);
  expect(download.suggestedFilename()).toBe('vacancy-description.md');
  await expect(page.locator('#export-markdown')).toHaveValue(/^# Черновик без сети/);
});

test('S23: ошибка буфера обмена — «Выделить текст» и скачивание', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await open(page, 'full');
  await answerWithText(page, FULL.q1);
  await confirm(page);
  await page.locator('.question-nav__step', { hasText: '4' }).click();
  await page.getByRole('button', { name: /Пропустить и к обзору/ }).click();
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await page.getByRole('button', { name: 'Копировать' }).click();
  const err = page.locator('[data-state-id="S23"]');
  await expect(err).toContainText('Не удалось скопировать текст');
  await err.getByRole('button', { name: 'Выделить текст' }).click();
  await expect(page.locator('#export-markdown')).toBeFocused();
  const selected = await page.evaluate(() => {
    const el = document.getElementById('export-markdown') as HTMLTextAreaElement;
    return el.selectionEnd - el.selectionStart === el.value.length;
  });
  expect(selected).toBe(true);
});

test('S26: конфигурация не загружена — режим не предполагается, повтор', async ({ page }) => {
  let fail = true;
  await page.route('**/api/config', async (route) => {
    if (fail) await route.abort('connectionrefused');
    else await route.continue();
  });
  await page.goto('/');
  const screen = page.locator('[data-state-id="S26"]');
  await expect(screen).toContainText('Не удалось подключиться к сервису');
  await expect(page.getByTestId('mode-tag')).toHaveCount(0);
  fail = false;
  await screen.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('[data-state-id="S01"]')).toBeVisible();
});

test('S24 / T19: live без настройки — ошибка конфигурации, без перехода в demo', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0',
        mode: 'live',
        limits: { maxRecordingSeconds: 120, maxAudioBytes: 10485760, maxAnswerChars: 4000, maxActiveAnswers: 12, maxSessionChars: 24000, maxClarificationsPerQuestion: 2 },
        live: { sttConfigured: false, llmConfigured: false, sttModel: 'nova-3', sttLanguage: 'ru', llmModel: null },
      }),
    }),
  );
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: errorBody('CONFIGURATION_ERROR', { retryable: false }) }));
  await page.goto('/');
  await expect(page.getByTestId('mode-tag')).toContainText('Live не настроен');
  await expect(page.locator('[data-state-id="S24"]')).toContainText('Не все этапы подключены');
  await expect(page.getByText('Аудио будет отправлено сервису распознавания')).toBeVisible();
  await page.getByRole('button', { name: 'Начать' }).click();
  await submitText(page, 'Пишет отчёты для бухгалтерии.');
  const err = page.locator('[data-state-id="S24"]');
  await expect(err).toContainText('Демонстрация не включается автоматически');
  await expect(page.getByText('Демонстрация', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('answer-card').locator('textarea')).toHaveValue('Пишет отчёты для бухгалтерии.');
});
