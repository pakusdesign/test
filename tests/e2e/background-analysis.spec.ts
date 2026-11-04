import { expect, test } from '@playwright/test';
import { FULL, open } from './helpers';

test('можно ответить на следующий вопрос до завершения анализа первого', async ({ page }) => {
  await open(page, 'full');
  let calls = 0;
  await page.route('**/api/analyze', async (route) => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      await route.abort().catch(() => undefined);
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.getByRole('button', { name: 'Далее' })).toBeEnabled();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.locator('#question-title')).toContainText('Над каким проектом');
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q2);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('answer-card')).toContainText(FULL.q2);
  await expect(page.getByRole('button', { name: 'Подтвердить сведения' })).toBeEnabled();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.locator('#question-title')).toContainText('В ближайшие полгода');
});

test('можно начать запись следующего ответа во время анализа', async ({ page }) => {
  await open(page, 'full');
  let calls = 0;
  await page.route('**/api/analyze', async (route) => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      await route.abort().catch(() => undefined);
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Завершить запись' }).click();
  await expect(page.getByTestId('recorded-panel')).toBeVisible();
});

test('готовый анализ не возвращает пользователя на предыдущий вопрос', async ({ page }) => {
  await open(page, 'full');
  await page.route('**/api/analyze', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  const analysisDone = page.waitForResponse((response) => response.url().endsWith('/api/analyze') && response.ok());
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.locator('#question-title')).toContainText('Над каким проектом');
  await analysisDone;
  await expect(page.locator('#question-title')).toContainText('Над каким проектом');
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByTestId('fact')).toHaveCount(2);
});

test('обзор показывает работу над сохранёнными ответами и отступ у кнопки возврата', async ({ page }) => {
  await open(page, 'full');
  await page.route('**/api/analyze', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await route.abort().catch(() => undefined);
  });
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q1);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill(FULL.q2);
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Пропустить вопрос' }).click();
  await page.getByRole('button', { name: 'Пропустить и к обзору' }).click();
  await expect(page.getByTestId('overview-q1')).toContainText('В работе · 50%');
  await expect(page.getByTestId('overview-q2')).toContainText('В работе · 50%');
  await expect(page.getByTestId('overview-q1')).not.toContainText('Подтверждённых сведений нет.');
  const card = await page.getByTestId('overview-q4').boundingBox();
  const button = await page.getByRole('button', { name: 'Вернуться к вопросу с пробелами' }).boundingBox();
  expect(card && button && button.y - (card.y + card.height)).toBeGreaterThanOrEqual(16);
});
