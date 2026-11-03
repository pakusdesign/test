/**
 * Сбор доказательств для отчёта: скриншоты галереи и пути, ширины окна,
 * видео анимации круга, замеры кадров. Запуск: npm run evidence.
 * Результаты: docs/evidence/. Это не замена тестам из tests/e2e.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

const OUT = path.resolve('docs/evidence');
const STATES = [
  ...Array.from({ length: 26 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`),
];

const FULL = {
  q1: 'Ежедневно анализирует отказы оплаты и проверяет отчёты по конверсии.',
  q2: 'Работает над платёжным модулем магазина. Его задача — найти причины неуспешных платежей.',
  q3: 'Следующие полгода продолжит этот же платёжный модуль.',
  q4: 'Нужны SQL и Metabase, знание воронок оплаты. Python желателен.',
};

test.beforeAll(async () => {
  await mkdir(path.join(OUT, 'states'), { recursive: true });
  await mkdir(path.join(OUT, 'flow'), { recursive: true });
  await mkdir(path.join(OUT, 'viewports'), { recursive: true });
});

async function shot(page: Page, file: string, fullPage = true) {
  // Липкая шапка в полностраничном снимке остаётся вверху только без прокрутки.
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, file), fullPage, animations: 'disabled' });
}

test('галерея: S01–S26, N01–N10, круг, компоненты, fallback', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const id of STATES) {
    await page.goto(`/#/gallery/state/${id}`);
    await expect(page.locator(`[data-gallery-state="${id}"]`)).toBeVisible();
    await shot(page, `states/${id}.png`);
  }
  await page.goto('/#/gallery');
  await expect(page.getByTestId('ring-playground')).toBeVisible();
  await page.locator('.gallery-grid').screenshot({ path: path.join(OUT, 'ring-states.png') });
  await page.locator('.gallery-components').screenshot({ path: path.join(OUT, 'components.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/gallery');
  await page.locator('.gallery-grid').screenshot({ path: path.join(OUT, 'ring-states-reduced-motion.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/#/gallery/state/S14?opaque');
  await shot(page, 'opaque-fallback-S14.png');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/#/gallery/state/S05');
  await shot(page, 'forced-colors-S05.png');
});

test('основной путь: начало, запись, частичная полнота, уточнение, обзор, результат', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('mode-tag')).toBeVisible();
  await shot(page, 'flow/01-start.png', false);
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Записать ответ' }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'flow/02-recording.png', false);
  await page.getByRole('button', { name: 'Завершить запись' }).click();
  await shot(page, 'flow/03-recorded-demo.png', false);
  await page.getByRole('button', { name: 'Подставить ответ сценария' }).click();
  await expect(page.getByTestId('review')).toBeVisible();
  await shot(page, 'flow/04-review.png');
  await page.getByRole('button', { name: 'Подтвердить сведения' }).click();
  await expect(page.getByTestId('clarification')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, 'flow/05-partial-and-clarification.png');
  await page.getByTestId('clarification').getByRole('button', { name: 'Подставить ответ сценария' }).click();
  await page.getByRole('button', { name: 'Подтвердить сведения' }).click();
  for (const q of ['q2', 'q3', 'q4'] as const) {
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Ответить текстом' }).click();
    await page.locator('#composer-text').fill(FULL[q]);
    await page.getByRole('button', { name: 'Проверить ответ' }).click();
    await page.getByRole('button', { name: 'Подтвердить сведения' }).click();
  }
  await page.waitForTimeout(700);
  await shot(page, 'flow/06-complete-100.png', false);
  await page.getByRole('button', { name: 'К обзору' }).click();
  await page.getByRole('button', { name: 'Проверять счета поставщиков.' }).click();
  await shot(page, 'flow/07-overview-with-source.png');
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
  await shot(page, 'flow/08-result.png');
  await page.locator('#doc-title').fill('Аналитик платежей');
  await shot(page, 'flow/09-result-edited.png');

  // Ширины окна на экране результата и вопроса.
  for (const [w, h] of [
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await shot(page, `viewports/result-${w}x${h}.png`, false);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'К обзору' }).click();
  await shot(page, 'viewports/overview-1024x768.png', false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'viewports/overview-1440x900.png', false);
  await page.setViewportSize({ width: 640, height: 400 });
  await shot(page, 'viewports/overview-zoom200-640.png', false);
});

test('видео анимации круга и замеры кадров', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    recordVideo: { dir: path.join(OUT, 'video-tmp'), size: { width: 900, height: 700 } },
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  await page.goto('/#/gallery');
  await expect(page.getByTestId('ring-playground')).toBeVisible();
  await page.getByTestId('ring-playground').scrollIntoViewIfNeeded();

  // Замер: покадровые интервалы во время последовательности заполнения.
  const fill = await page.evaluate(async () => {
    const deltas: number[] = [];
    let last = performance.now();
    (document.querySelector('[data-testid="pg-sequence"]') as HTMLElement).click();
    const t0 = last;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        deltas.push(now - last);
        last = now;
        if (now - t0 < 3400) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return deltas;
  });
  await page.waitForTimeout(600);
  // Смена цели во время движения.
  await page.getByTestId('pg-clear').click();
  await page.waitForTimeout(500);
  await page.getByTestId('pg-interrupt').click();
  await page.waitForTimeout(900);
  // Ореол: уровень из галереи (без микрофона), затем снижение.
  await page.getByRole('button', { name: 'Запись (ореол)' }).click();
  for (const v of ['0.2', '0.6', '1', '0.4', '0']) {
    await page.locator('.gallery-range input').fill(v);
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: 'Остановить запись (ореол)' }).click();
  await page.waitForTimeout(400);
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(path.join(OUT, 'ring-animation.webm'));

  // Ореол от фиктивного микрофона Chromium: интервалы между обновлениями уровня 10 с.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  const p2 = await ctx2.newPage();
  await p2.goto('/');
  await p2.getByRole('button', { name: 'Начать' }).click();
  await p2.getByRole('button', { name: 'Записать ответ' }).click();
  await expect(p2.getByTestId('recording-panel')).toBeVisible();
  const halo = await p2.evaluate(async () => {
    const el = document.querySelector('.vpr__halo') as SVGElement;
    const deltas: number[] = [];
    const scales = new Set<string>();
    let lastChange = performance.now();
    let prev = el.style.transform;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const obs = new MutationObserver(() => {
        const now = performance.now();
        if (el.style.transform !== prev) {
          deltas.push(now - lastChange);
          lastChange = now;
          prev = el.style.transform;
          scales.add(prev);
        }
        if (now - t0 > 10_000) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(el, { attributes: true, attributeFilter: ['style'] });
      setTimeout(() => {
        obs.disconnect();
        resolve();
      }, 10_500);
    });
    return { deltas, distinctScales: scales.size };
  });
  await p2.getByRole('button', { name: 'Завершить запись' }).click();
  await ctx2.close();

  const stats = (d: number[]) => {
    const sorted = [...d].filter((x) => x > 0).sort((a, b) => a - b);
    const pct = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 10) / 10;
    return {
      frames: sorted.length,
      meanMs: Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10,
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      maxMs: Math.round(sorted[sorted.length - 1]! * 10) / 10,
      over20ms: sorted.filter((x) => x > 20).length,
      over34ms: sorted.filter((x) => x > 34).length,
    };
  };
  const report = {
    date: new Date().toISOString(),
    browser: `Chromium ${chromium.executablePath() ? browser.version() : 'unknown'} (headless, Playwright 1.63.0)`,
    environment: 'Облачный Linux-контейнер без GPU. Значения headless не равны частоте реального экрана 60 Hz.',
    fillSequence: { note: 'rAF-интервалы во время 0→12.5→25→50→100 в галерее, 3.4 с', ...stats(fill) },
    haloUpdates: {
      note: 'Интервалы между изменениями transform ореола при записи фиктивного микрофона Chromium, 10 с',
      distinctScaleValues: halo.distinctScales,
      ...stats(halo.deltas),
    },
  };
  await writeFile(path.join(OUT, 'motion-metrics.json'), JSON.stringify(report, null, 2) + '\n');
});
