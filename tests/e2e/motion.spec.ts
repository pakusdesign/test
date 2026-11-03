/**
 * T33–T38: фактические параметры анимации круга (WAAPI/CSS), разреженное
 * заполнение, смена цели во время движения, скрытая вкладка, отделение 100% от документа.
 */
import { expect, test, type Page } from '@playwright/test';
import { FULL, answerWithText, confirm, open } from './helpers';

const playground = (page: Page) => page.getByTestId('ring-playground');

async function openPlayground(page: Page) {
  await page.goto('/#/gallery');
  await expect(playground(page)).toBeVisible();
}

async function maskOffsets(page: Page) {
  return playground(page)
    .locator('.vpr__mask-arc')
    .evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).strokeDashoffset)));
}

async function transitionsOf(page: Page, index: number) {
  return playground(page)
    .locator('.vpr__mask-arc')
    .nth(index)
    .evaluate((el) =>
      el.getAnimations().map((a) => {
        const t = (a.effect as KeyframeEffect).getTiming();
        return { duration: t.duration, easing: t.easing, property: (a as CSSTransition).transitionProperty };
      }),
    );
}

/** Клик и покадровая запись dashoffset всех 8 масок внутри страницы (без задержек драйвера). */
async function sampleAfter(page: Page, selector: string, durationMs: number) {
  return page.evaluate(
    async ({ selector, durationMs }) => {
      const root = document.querySelector('[data-testid="ring-playground"]')!;
      const paths = [...root.querySelectorAll('.vpr__mask-arc')];
      const label = root.querySelector('.vpr__value')!;
      const target = root.querySelector(selector) as HTMLElement;
      const frames: { t: number; o: number[]; label: string; anims: number[] }[] = [];
      const t0 = performance.now();
      target.click();
      await new Promise<void>((resolve) => {
        const tick = () => {
          frames.push({
            t: performance.now() - t0,
            o: paths.map((p) => Number.parseFloat(getComputedStyle(p).strokeDashoffset)),
            label: label.textContent ?? '',
            anims: paths.map((p) => p.getAnimations().length),
          });
          if (performance.now() - t0 < durationMs) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
      return frames;
    },
    { selector, durationMs },
  );
}

const FULL_ARC = 68.173;

test('T33: 64 штриха; рост группы — 400 ms с кривой спецификации; снижение — 240 ms; подпись округляется', async ({ page }) => {
  await openPlayground(page);
  await expect(playground(page).locator('.vpr__tick')).toHaveCount(64);
  const frames = await sampleAfter(page, 'input[id="pg-q1.task1"]', 700);
  // Подпись обновляется сразу на целевое значение.
  expect(frames[0]!.label).toBe('13%');
  const t = await transitionsOf(page, 0);
  expect(t).toEqual([]); // переход завершён
  const done = frames.find((f) => f.o[0] === 0)!;
  const mid = frames.find((f) => f.t >= 150 && f.t <= 250)!;
  // Длительность 400 ms ± кадр и точность замера.
  expect(done.t).toBeGreaterThan(330);
  expect(done.t).toBeLessThan(500);
  expect(mid.o[0]).toBeGreaterThan(0);
  expect(mid.o[0]).toBeLessThan(FULL_ARC);
  // ease-out: к середине времени пройдено больше половины пути.
  expect(mid.o[0]).toBeLessThan(FULL_ARC / 2);
  // Остальные группы не двигались.
  expect(frames.every((f) => f.o.slice(1).every((o) => Math.abs(o - FULL_ARC) < 0.01))).toBe(true);

  // Точные параметры CSS-перехода из WAAPI.
  const timing = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="ring-playground"]')!;
    (root.querySelector('input[id="pg-q1.task1"]') as HTMLElement).click();
    const path = root.querySelectorAll('.vpr__mask-arc')[0]!;
    return path.getAnimations().map((a) => {
      const tm = (a.effect as KeyframeEffect).getTiming();
      return { duration: tm.duration, easing: tm.easing, property: (a as CSSTransition).transitionProperty };
    });
  });
  expect(timing).toEqual([{ duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', property: 'stroke-dashoffset' }]);
  await page.waitForTimeout(300);
  const up = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="ring-playground"]')!;
    (root.querySelector('input[id="pg-q1.task1"]') as HTMLElement).click();
    const tm = (root.querySelectorAll('.vpr__mask-arc')[0]!.getAnimations()[0]!.effect as KeyframeEffect).getTiming();
    return { duration: tm.duration, easing: tm.easing };
  });
  expect(up).toEqual({ duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
});

test('T33: последовательность 0 → 12.5 → 25 → 50 → 100; несколько групп стартуют одновременно; знак после заполнения', async ({ page }) => {
  await openPlayground(page);
  const frames = await sampleAfter(page, '[data-testid="pg-sequence"]', 3400);
  const labels = [...new Set(frames.map((f) => f.label))];
  expect(labels).toEqual(['0%', '13%', '25%', '50%', '100%']);
  // На шаге 50 → 100 четыре группы q3/q4 запускаются в одном кадре.
  const step = frames.find((f) => f.label === '100%')!;
  expect(step.anims.slice(4)).toEqual([1, 1, 1, 1]);
  const lastFrame = frames[frames.length - 1]!;
  expect(lastFrame.o.every((o) => o === 0)).toBe(true);
  await expect(playground(page).locator('.vpr__success')).toHaveAttribute('data-visible', 'true');
  await expect(playground(page).locator('.vpr__success')).toHaveAttribute('data-animate', 'true');
  const delay = await playground(page).locator('.vpr__success').evaluate((el) => getComputedStyle(el).transitionDelay);
  expect(delay).toBe('0.4s');
});

test('T34: разреженное заполнение — светятся только q2 и q4 в своих секторах', async ({ page }) => {
  await page.goto('/#/gallery');
  const cell = page.getByTestId('ring-Разреженное 50%: q2 и q4');
  await expect(cell).toBeVisible();
  const filled = await cell.locator('.vpr__group').evaluateAll((els) => els.map((e) => e.getAttribute('data-filled')));
  expect(filled).toEqual(['false', 'false', 'true', 'true', 'false', 'false', 'true', 'true']);
  // Сектор q2 справа, q4 слева: геометрия не уплотняется к началу круга.
  const centers = await cell.locator('.vpr__group').evaluateAll((els) =>
    els.map((g) => {
      const r = g.getBoundingClientRect();
      return r.left + r.width / 2;
    }),
  );
  const ringBox = await cell.locator('.vpr__svg').boundingBox();
  const mid = ringBox!.x + ringBox!.width / 2;
  expect(centers[2]).toBeGreaterThan(mid);
  expect(centers[6]).toBeLessThan(mid);
  await expect(cell.locator('.vpr__value')).toHaveText('50%');
});

test('T36: смена цели во время движения — продолжение от текущего значения, без сброса и без устаревшего успеха', async ({ page }) => {
  await openPlayground(page);
  // 0 → 100%, через 150 ms → только q2 и q4.
  const frames = await sampleAfter(page, '[data-testid="pg-interrupt"]', 900);
  const g0 = frames.map((f) => f.o[0]!);
  const g2 = frames.map((f) => f.o[2]!);
  // Группа 0 успела частично заполниться и затем гаснет от текущего значения.
  const minG0 = Math.min(...g0);
  expect(minG0).toBeGreaterThan(0);
  expect(minG0).toBeLessThan(FULL_ARC);
  // До смены цели группа 0 только заполняется; после — только гаснет, начиная с текущего значения.
  const k = frames.findIndex((f) => f.label === '50%');
  expect(k).toBeGreaterThan(0);
  for (let i = 1; i < k; i += 1) expect(g0[i]!).toBeLessThanOrEqual(g0[i - 1]! + 0.01);
  for (let i = k + 1; i < g0.length; i += 1) expect(g0[i]!).toBeGreaterThanOrEqual(g0[i - 1]! - 0.01);
  // В кадре смены цели нет мгновенного сброса к полностью погашенному состоянию.
  expect(g0[k]!).toBeLessThan(FULL_ARC * 0.95);
  // Группа 2 (q2.project) заполняется монотонно, без возврата к началу.
  for (let i = 1; i < g2.length; i += 1) expect(g2[i]!).toBeLessThanOrEqual(g2[i - 1]! + 0.01);
  const final = frames[frames.length - 1]!.o.map((o) => o === 0);
  expect(final).toEqual([false, false, true, true, false, false, true, true]);
  expect(frames[frames.length - 1]!.label).toBe('50%');
  await expect(playground(page).locator('.vpr__success')).toHaveAttribute('data-visible', 'false');
});

test('T36: скрытая вкладка — переходы приостановлены, при возврате сразу актуальное значение', async ({ page }) => {
  await openPlayground(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(playground(page).locator('.vpr')).toHaveAttribute('data-paused', 'true');
  await playground(page).getByLabel(/^q2\.project/).check({ force: true });
  const offsets = await maskOffsets(page);
  expect(offsets[2]).toBe(0);
  expect(await playground(page).locator('.vpr__mask-arc').nth(2).evaluate((el) => el.getAnimations().length)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(playground(page).locator('.vpr')).toHaveAttribute('data-paused', 'false');
});

test('T35 / T38: ожидание — один InlineLoading, процент не растёт; 100% отделено от готовности документа', async ({ page }) => {
  await open(page, 'full');
  let release: (() => void) | null = null;
  await page.route('**/api/generate', async (route) => {
    await new Promise<void>((r) => (release = r));
    await route.continue();
  });
  for (const q of ['q1', 'q2', 'q3', 'q4'] as const) {
    await answerWithText(page, FULL[q]);
    await confirm(page);
    await page.getByRole('button', { name: /Далее|К обзору/ }).click();
  }
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await expect(page.locator('.cds--inline-loading')).toHaveCount(1);
  await expect(page.locator('.vpr__stage')).toContainText('Составляем описание вакансии');
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '100');
  // Во время ожидания нет вращения или движения заполненных штрихов.
  const anims = await page.locator('.vpr__mask-arc').evaluateAll((els) => els.reduce((n, el) => n + el.getAnimations().length, 0));
  expect(anims).toBe(0);
  release!();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
  await expect(page.locator('.cds--inline-loading')).toHaveCount(0);
});

test('T37: снижение полноты после правки гасит только нужные группы и показывает причину', async ({ page }) => {
  await open(page, 'full');
  for (const q of ['q1', 'q2'] as const) {
    await answerWithText(page, FULL[q]);
    await confirm(page);
    await page.getByRole('button', { name: 'Далее' }).click();
  }
  await page.locator('.question-nav__step', { hasText: '1' }).click();
  await page.getByTestId('answer-card').locator('textarea').fill('Проверяет счета поставщиков.');
  await page.getByTestId('answer-card').getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('.vpr__note')).toContainText('Ответ изменён. Проверьте сведения ещё раз');
  const filled = await page.locator('.vpr__group').evaluateAll((els) => els.map((e) => e.getAttribute('data-filled')));
  expect(filled).toEqual(['false', 'false', 'true', 'true', 'false', 'false', 'false', 'false']);
});
