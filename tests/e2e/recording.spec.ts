/**
 * Запись: разрешение, отказ, отмена, лимит, пустой ответ, ореол только от сигнала.
 * Chromium с фиктивным устройством: MediaRecorder и Web Audio работают по-настоящему,
 * сигнал — синтетический тон. Реальный русский голос и Safari — ручная проверка.
 */
import { expect, test } from '@playwright/test';
import { expectPercent, open } from './helpers';

test('T02 / S11: отказ в доступе к микрофону — понятная ошибка и текстовый путь', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  const err = page.locator('[data-state-id="S11"]');
  await expect(err).toContainText('Нет доступа к микрофону');
  // Микрофон после ошибки автоматически не запускается.
  await expect(page.getByTestId('recording-panel')).toHaveCount(0);
  await err.getByRole('button', { name: 'Ответить текстом' }).click();
  await expect(page.getByTestId('composer')).toBeVisible();
});

test('S12: микрофон не найден', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError'));
  });
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.locator('[data-state-id="S12"]')).toContainText('Микрофон не найден');
});

test('S10: ожидание разрешения — ореола нет, отмена возвращает к вопросу', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => undefined);
  });
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.locator('[data-state-id="S10"]')).toContainText('Разрешите доступ к микрофону в браузере');
  await expect(page.locator('.vpr__halo-wrap').first()).toHaveAttribute('data-active', 'false');
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.locator('[data-state-id="S02"]')).toBeVisible();
});

test('запись: ореол активен только во время записи и меняется от реального сигнала; процент не растёт', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  await expect(page.locator('.vpr__halo-wrap').first()).toHaveAttribute('data-active', 'true');
  // Сигнал фиктивного устройства меняет transform ореола (без React-перерисовки).
  await expect
    .poll(async () => page.locator('.vpr__halo').first().evaluate((el) => (el as SVGElement).style.transform), { timeout: 5000 })
    .toMatch(/scale\(1\.0[0-3]\d*\)/);
  await page.waitForTimeout(1500);
  await expectPercent(page, 0);
  await page.getByRole('button', { name: 'Отменить запись' }).click();
  await expect(page.locator('.vpr__halo-wrap').first()).toHaveAttribute('data-active', 'false');
  const live = await page.evaluate(() => (window.__vbStreams ?? []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
  expect(live).toBe(0);
});

test('запись сохраняется локально: прослушивание, удаление, повторная запись', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Завершить запись' }).click();
  const panel = page.getByTestId('recorded-panel');
  await expect(panel.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(panel).toContainText('не отправлялась на сервер');
  await panel.getByRole('button', { name: 'Удалить запись' }).click();
  await expect(page.locator('[data-state-id="S02"]')).toBeVisible();
});

test('T03: лимит 2 минуты останавливает запись без потери накопленного аудио', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  // Реальные фрагменты MediaRecorder идут по времени медиапотока; ждём первые данные.
  await page.clock.runFor(1500);
  await page.waitForTimeout(1500);
  await page.clock.fastForward('02:01');
  const panel = page.getByTestId('recorded-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-state-id="S16"]')).toContainText('Достигнут предел записи');
  await expect(panel.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(panel.getByRole('button', { name: 'Подставить ответ сценария' })).toBeVisible();
});

test('T03 / S04: тишина или пустой ответ не дают фактов и прогресса', async ({ page }) => {
  await open(page, 'one_task');
  await page.getByRole('button', { name: 'Пропустить вопрос' }).click();
  // Во втором вопросе сценария нет ответа — имитация нераспознанной речи.
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Завершить запись' }).click();
  await page.getByRole('button', { name: 'Подставить ответ сценария' }).click();
  const err = page.locator('[data-state-id="S04"]');
  await expect(err).toContainText('Не удалось распознать речь');
  await expect(err.getByRole('button', { name: 'Записать ещё раз' })).toBeVisible();
  await expect(err.getByRole('button', { name: 'Ответить текстом' })).toBeVisible();
  await expectPercent(page, 0);
  // Запись осталась в вкладке до явного удаления.
  await expect(page.getByTestId('recorded-panel').locator('audio')).toHaveAttribute('src', /^blob:/);
});
