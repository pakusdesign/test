/**
 * Основной путь в demo: голос → расшифровка сценария → факты → уточнение →
 * подтверждение → обзор → генерация → редактирование → копирование и скачивание.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { FULL, answerWithText, answerWithVoice, confirm, expectPercent, open, ring } from './helpers';

test('сквозной сценарий с уточнением: от записи до Markdown (T01, T05, T07, T11, T14)', async ({ page }) => {
  await open(page);
  await expectPercent(page, 0);

  // q1: голос → одна задача.
  await answerWithVoice(page);
  await expect(page.getByText('Ответ из тестового сценария').first()).toBeVisible();
  await expect(page.getByTestId('fact')).toHaveCount(1);
  // Анализ сам по себе прогресс не даёт.
  await expectPercent(page, 0);
  // T01: после завершения записи нет активных media tracks.
  const live = await page.evaluate(() => (window.__vbStreams ?? []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
  expect(live).toBe(0);

  await confirm(page);
  await expectPercent(page, 12.5);
  await expect(ring(page)).toContainText('13%');
  // T07: уточнение просит вторую задачу, есть выход без уточнения.
  const clar = page.getByTestId('clarification');
  await expect(clar).toContainText('Какую ещё задачу он выполняет ежедневно?');
  await expect(clar.getByRole('button', { name: 'Продолжить без уточнения' })).toBeVisible();
  await clar.getByRole('button', { name: 'Подставить ответ сценария' }).click();
  await expect(page.getByTestId('answer-card')).toHaveCount(2);
  await expectPercent(page, 12.5);
  await confirm(page);
  await expectPercent(page, 25);
  await expect(page.getByTestId('clarification')).toHaveCount(0);

  // q2–q4.
  for (const q of ['q2', 'q3', 'q4'] as const) {
    await page.getByRole('button', { name: 'Далее' }).click();
    await answerWithText(page, FULL[q]);
    await confirm(page);
  }
  await expectPercent(page, 100);
  await expect(page.locator('.vpr').first()).toContainText('Данных по четырём вопросам достаточно');

  // Обзор: источник факта.
  await page.getByRole('button', { name: 'К обзору' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор ответов' })).toBeVisible();
  await page.getByRole('button', { name: 'Проверять счета поставщиков.' }).click();
  await expect(page.getByText('«Проверяет счета поставщиков»')).toBeVisible();

  // Генерация.
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
  for (const id of ['daily_tasks', 'current_project', 'next_six_months', 'tools', 'knowledge']) {
    await expect(page.getByTestId(`section-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('section-tools').locator('textarea').filter({ hasText: 'Python желателен.' })).toHaveCount(1);
  const body = await page.locator('main').innerText();
  for (const word of ['зарплат', 'удалённ', 'стаж', 'senior']) expect(body.toLowerCase()).not.toContain(word);
  await expect(page.locator('.doc-gaps__list')).toContainText('Название должности не указано.');
  // 100% до генерации остаётся 100%; документ отделён от полноты.
  await expectPercent(page, 100);

  // T14: правка, копирование, скачивание.
  await page.locator('#doc-title').fill('Аналитик платежей');
  await expect(page.getByText('Изменено вручную')).toBeVisible();
  await page.getByRole('button', { name: 'Копировать' }).click();
  await expect(page.getByText('Текст скопирован')).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip.startsWith('# Аналитик платежей')).toBe(true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать .md' }).click()]);
  expect(download.suggestedFilename()).toBe('vacancy-description.md');
  const file = await readFile((await download.path())!, 'utf8');
  expect(file).toBe(clip);
  expect(file).toBe(await page.locator('#export-markdown').inputValue());
});

test('T23: повторная генерация после ручной правки требует выбора; отмена сохраняет текст', async ({ page }) => {
  await open(page, 'full');
  for (const q of ['q1', 'q2', 'q3', 'q4'] as const) {
    await answerWithText(page, FULL[q]);
    await confirm(page);
    await page.getByRole('button', { name: /Далее|К обзору/ }).click();
  }
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await page.locator('#doc-title').fill('Мой заголовок');
  await page.getByRole('button', { name: 'Создать заново' }).click();
  const modal = page.getByRole('dialog', { name: 'Заменить ручные правки?' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.locator('#doc-title')).toHaveValue('Мой заголовок');
  await page.getByRole('button', { name: 'Создать заново' }).click();
  await page.getByRole('dialog', { name: 'Заменить ручные правки?' }).getByRole('button', { name: 'Заменить текст' }).click();
  await expect(page.locator('#doc-title')).toHaveValue('Описание вакансии');
  await expect(page.getByText('Изменено вручную')).toHaveCount(0);
});

test('S22: после правки ответа документ устаревает, экспорт требует подтверждения', async ({ page }) => {
  await open(page, 'full');
  for (const q of ['q1', 'q2', 'q3', 'q4'] as const) {
    await answerWithText(page, FULL[q]);
    await confirm(page);
    await page.getByRole('button', { name: /Далее|К обзору/ }).click();
  }
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await page.getByRole('button', { name: 'К обзору' }).click();
  await page.getByTestId('overview-q4').getByRole('button', { name: 'Исправить' }).click();
  // Убираем «Python желателен» из подтверждения.
  await page.getByText('Python желателен.', { exact: true }).click();
  await confirm(page);
  await page.getByRole('button', { name: 'К обзору' }).click();
  await page.getByRole('button', { name: 'Открыть прежнее описание' }).click();
  await expect(page.locator('[data-state-id="S22"]')).toContainText('Ответы изменились. Обновите описание');
  await page.getByRole('button', { name: 'Скачать .md' }).click();
  await expect(page.getByRole('dialog', { name: 'Описание устарело' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.locator('[data-state-id="S22"]').getByRole('button', { name: 'Обновить описание' }).click();
  await expect(page.locator('[data-state-id="S22"]')).toHaveCount(0);
  await expect(page.getByTestId('section-tools').locator('textarea').filter({ hasText: 'Python желателен.' })).toHaveCount(0);
});

test('S09: «Начать заново» с подтверждением удаляет работу и возвращает S01', async ({ page }) => {
  await open(page, 'full');
  await answerWithText(page, FULL.q1);
  await confirm(page);
  await page.getByRole('button', { name: 'Начать заново' }).click();
  await page.getByRole('dialog', { name: 'Начать заново?' }).getByRole('button', { name: 'Удалить и начать заново' }).click();
  await expect(page.locator('[data-state-id="S01"]')).toBeVisible();
  await expectPercent(page, 0);
  await expect(page.getByRole('button', { name: 'Начать заново' })).toHaveCount(0);
});
