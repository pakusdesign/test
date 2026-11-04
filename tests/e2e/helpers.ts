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
  return page.getByRole('progressbar', { name: 'Прогресс заполнения требований к вакансии' }).first();
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

/**
 * Замер светового слоя круга (canvas). Для каждой четверти q1–q4 — максимальная толщина
 * насыщенного света по радиусу (в единицах viewBox 220) и средний цвет обода.
 * Белая подложка центра и слабое рассеянное свечение не учитываются.
 */
export async function ringLight(page: Page, root = page.locator('.vpr').first()) {
  return root.locator('canvas.vpr__light').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const unit = canvas.width / 300; // viewBox 220 + запас света 2×40
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = (x: number, y: number) => {
      const i = (Math.round(y * unit) * canvas.width + Math.round(x * unit)) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const;
    };
    const zones = [45, 135, 225, 315].map((mid) => {
      let thickness = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let off = -36; off <= 36; off += 3) {
        const a = ((mid + off - 90) * Math.PI) / 180;
        let count = 0;
        for (let rad = 76; rad <= 120; rad += 0.25) {
          const [R, G, B, A] = px(150 + rad * Math.cos(a), 150 + rad * Math.sin(a));
          if (A > 200 && Math.max(R, G, B) - Math.min(R, G, B) > 60) {
            count += 1;
            r += R;
            g += G;
            b += B;
            n += 1;
          }
        }
        thickness = Math.max(thickness, count * 0.25);
      }
      return { thickness, rgb: n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0] };
    });
    let hash = 0;
    for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]!) | 0;
    return { zones, hash };
  });
}

/** Тёплый (красно-оранжевый) обод: красный канал заметно выше синего. */
export const isWarm = (rgb: number[]) => rgb[0]! > rgb[2]! + 40;
