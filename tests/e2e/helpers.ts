import { expect, type Page } from '@playwright/test';

export async function open(page: Page, scenario = 'guided') {
  await page.addInitScript(() => {
    window.__vbStreams = [];
  });
  await page.goto('/');
  await expect(page.getByTestId('mode-tag')).toContainText('Демонстрация');
  if (scenario !== 'guided') await page.getByLabel('Тестовый сценарий демонстрации').selectOption(scenario);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#question-title')).toBeVisible();
}

export function ring(page: Page) {
  return page.getByRole('progressbar', { name: 'Полнота требований к вакансии' }).first();
}

export async function expectPercent(page: Page, value: number) {
  await expect(ring(page)).toHaveAttribute('aria-valuenow', String(value));
}

/** Текстовый ответ через выбор текста из каталога demo. */
export async function answerWithText(page: Page, text: string) {
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(text);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить сведения' })).toBeEnabled();
}

/** Текст без ожидания подтверждения (для ответов без фактов). */
export async function submitText(page: Page, text: string) {
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(text);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.locator('.vpr').first()).not.toHaveAttribute('data-stage', 'processing');
}

export async function confirm(page: Page) {
  await page.getByRole('button', { name: 'Подтвердить сведения' }).click();
}

/** Ответ голосом в demo: настоящая запись фиктивного микрофона + ответ сценария. */
export async function answerWithVoice(page: Page, seconds = 1) {
  await page.getByRole('button', { name: 'Записать ответ' }).first().click();
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: 'Завершить запись' }).click();
  await expect(page.getByTestId('recorded-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Подставить ответ сценария' }).click();
  await expect(page.getByTestId('review')).toBeVisible();
}

export const FULL = {
  q1: 'Ежедневно анализирует отказы оплаты и проверяет отчёты по конверсии.',
  q2: 'Работает над платёжным модулем магазина. Его задача — найти причины неуспешных платежей.',
  q3: 'Следующие полгода продолжит этот же платёжный модуль.',
  q4: 'Нужны SQL и Metabase, знание воронок оплаты. Python желателен.',
};

export async function analyzeResponseFor(page: Page) {
  return page.waitForResponse((r) => r.url().endsWith('/api/analyze'));
}
