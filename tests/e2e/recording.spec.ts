/**
 * Запись: разрешение, отказ, отмена, лимит, пустой ответ, ореол только от сигнала.
 * Chromium с фиктивным устройством: MediaRecorder и Web Audio работают по-настоящему,
 * сигнал — синтетический тон. Реальный русский голос и Safari — ручная проверка.
 */
import { expect, test } from '@playwright/test';
import { expectPercent, open, ringLight } from './helpers';

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

test('S10: ожидание разрешения — ленты записи нет, отмена возвращает к вопросу', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => undefined);
  });
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.locator('[data-state-id="S10"]')).toContainText('Разрешите доступ к микрофону в браузере');
  // Акцент записи включается только после фактического старта MediaRecorder.
  await expect(page.locator('.vpr').first()).toHaveAttribute('data-recording-zone', '');
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.locator('[data-state-id="S02"]')).toBeVisible();
});

test('запись: лента и волны только в четверти вопроса во время записи; процент не растёт', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(page.getByTestId('recording-panel')).toBeVisible();
  const vpr = page.locator('.vpr').first();
  await expect(vpr).toHaveAttribute('data-recording-zone', 'q1');
  await expect(page.locator('.vpr__stage').first()).toHaveText('Идёт запись · вопрос 1 из 4');
  await page.waitForTimeout(500);
  // Сигнал фиктивного устройства идёт в световой слой: лента q1 широкая и меняется во времени.
  const a = await ringLight(page);
  expect(a.zones[0]!.thickness).toBeGreaterThanOrEqual(9);
  for (const i of [1, 2, 3]) expect(a.zones[i]!.thickness).toBeLessThan(6);
  await page.waitForTimeout(400);
  expect((await ringLight(page)).hash).not.toBe(a.hash);
  await page.waitForTimeout(1000);
  await expectPercent(page, 0);
  await page.getByRole('button', { name: 'Отменить запись' }).click();
  await expect(vpr).toHaveAttribute('data-recording-zone', '');
  await page.waitForTimeout(450);
  expect((await ringLight(page)).zones[0]!.thickness).toBeLessThan(6);
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
