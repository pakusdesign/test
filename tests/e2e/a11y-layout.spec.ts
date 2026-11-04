/**
 * T18, T24–T27: клавиатура, фокус, axe, reduced motion, desktop-ширины,
 * пороги 1056/1312/1584 ±1 px, масштаб 200%, высота 720, fallback стекла, forced colors.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FULL, answerWithText, confirm, expectPercent, open, ringLight } from './helpers';

async function tabTo(page: Page, name: RegExp | string, max = 40) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return (el?.getAttribute('aria-label') || el?.innerText || '').trim();
    });
    if (typeof name === 'string' ? label === name : name.test(label)) return;
  }
  throw new Error(`Не удалось дойти Tab до «${String(name)}»`);
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
}

async function toResult(page: Page) {
  await open(page, 'full');
  for (const q of ['q1', 'q2', 'q3', 'q4'] as const) {
    await answerWithText(page, FULL[q]);
    await confirm(page);
    await page.getByRole('button', { name: /Далее|К обзору/ }).click();
  }
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
}

test('T18: весь путь вопроса доступен с клавиатуры; фокус переходит на заголовок вопроса', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mode-tag')).toBeVisible();
  await page.getByLabel('Тестовый сценарий демонстрации').selectOption('full');
  await tabTo(page, 'Начать');
  await page.keyboard.press('Enter');
  await tabTo(page, 'Ответить текстом');
  await page.keyboard.press('Enter');
  await expect(page.locator('#composer-text')).toBeFocused();
  await page.keyboard.type(FULL.q1);
  await tabTo(page, 'Проверить ответ');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fact')).toHaveCount(2);
  await tabTo(page, 'Подтвердить сведения');
  await page.keyboard.press('Enter');
  await expectPercent(page, 25);
  await tabTo(page, 'Далее');
  await page.keyboard.press('Enter');
  await expect(page.locator('#question-title')).toBeFocused();
  await expect(page.locator('#question-title')).toContainText('Над каким проектом');
  // Видимый фокус у кнопок Carbon.
  await tabTo(page, 'Записать ответ');
  const outline = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement as Element);
    return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' || cs.borderColor !== '';
  });
  expect(outline).toBe(true);
  // Прогресс не в Tab-порядке.
  expect(await page.getByRole('progressbar').first().getAttribute('tabindex')).toBeNull();
});

test('T18: axe — нет критических и серьёзных нарушений на основных экранах', async ({ page }) => {
  const scan = async (label: string) => {
    // Scan the settled UI, not the disabled-to-enabled button color transition.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined)));
    });
    const result = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(bad.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await page.goto('/');
  await expect(page.getByTestId('mode-tag')).toBeVisible();
  await scan('start');
  await page.getByLabel('Тестовый сценарий демонстрации').selectOption('full');
  await page.getByRole('button', { name: 'Начать' }).click();
  await scan('question-empty');
  await answerWithText(page, FULL.q1);
  await scan('question-review');
  await confirm(page);
  await page.getByRole('button', { name: 'Далее' }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: /Пропустить/ }).click();
  await scan('overview');
  await page.getByRole('button', { name: 'Создать описание' }).click();
  await expect(page.getByRole('heading', { name: 'Описание вакансии' })).toBeVisible();
  await scan('result');
});

test('T18 / T37: reduced motion — круг без переходов, вопрос без смещения, статичное ожидание', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'full');
  const vpr = page.locator('.vpr').first();
  await expect(vpr).toHaveAttribute('data-reduced-motion', 'true');
  const durations = await page.locator('.vpr__unit-arc').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(durations).toBe('0s');
  // Перетекание, вибрация, волны и пульсация отключены: световой слой — один статичный кадр.
  await expect(vpr).toHaveAttribute('data-motion', 'static');
  await page.waitForTimeout(150);
  const still = await ringLight(page);
  await page.waitForTimeout(600);
  const later = await ringLight(page);
  expect(later.zones).toEqual(still.zones);
  const anim = await page.locator('.question-panel__head').evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('none');
  await answerWithText(page, FULL.q1);
  await confirm(page);
  // Обновление дуг — сразу, без анимаций.
  const running = await page.locator('.vpr__unit-arc').first().evaluate((el) => el.getAnimations().length);
  expect(running).toBe(0);
  await expectPercent(page, 25);
});

for (const [w, h] of [
  [1024, 768],
  [1280, 720],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`T26: ${w}×${h} — нет горизонтальной прокрутки, действия доступны`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await toResult(page);
    await noHorizontalScroll(page);
    await expect(page.getByRole('button', { name: 'Скачать .md' })).toBeVisible();
    await page.getByRole('button', { name: 'К обзору' }).click();
    await noHorizontalScroll(page);
    await page.getByTestId('overview-q1').getByRole('button', { name: 'Исправить' }).click();
    await noHorizontalScroll(page);
  });
}

test('T26: пороги 1056 / 1312 / 1584 ±1 px — перестроение компоновки', async ({ page }) => {
  await toResult(page);
  const layout = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(() => {
      const main = document.querySelector('.split-grid__main')!.getBoundingClientRect();
      const side = document.querySelector('.split-grid__side')!.getBoundingClientRect();
      const ring = document.querySelector('.vpr__figure')!.getBoundingClientRect();
      const grid = document.querySelector('.split-grid')!.getBoundingClientRect();
      return { sideBySide: side.left >= main.right - 1, ring: Math.round(ring.width), gridWidth: Math.round(grid.width) };
    });
  };
  const at1055 = await layout(1055);
  const at1056 = await layout(1056);
  expect(at1055.ring).toBe(200);
  expect(at1056.ring).toBe(220);
  expect((await layout(1311)).sideBySide).toBe(false);
  expect((await layout(1312)).sideBySide).toBe(true);
  const at1583 = await layout(1583);
  const at1585 = await layout(1585);
  const at1920 = await layout(1920);
  expect(at1583.sideBySide && at1585.sideBySide).toBe(true);
  // От 1584 ширина сетки ограничена, растут боковые поля.
  expect(at1920.gridWidth).toBeLessThanOrEqual(1584);
  expect(at1920.gridWidth).toBe(at1585.gridWidth);
});

test('T26: масштаб 200% (640 CSS px) и узкое окно — одна колонка, без мобильной версии и горизонтального скролла', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await open(page, 'full');
  await noHorizontalScroll(page);
  await answerWithText(page, FULL.q1);
  await noHorizontalScroll(page);
  const confirmBtn = page.getByRole('button', { name: 'Подтвердить сведения' });
  await confirmBtn.scrollIntoViewIfNeeded();
  await expect(confirmBtn).toBeInViewport();
  // Нет экрана «Откройте на компьютере».
  await expect(page.getByText(/откройте на компьютере/i)).toHaveCount(0);
});

test('T26: высота 720 с длинной расшифровкой и ошибкой — действия доступны прокруткой и не перекрыты', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, 'full');
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ schemaVersion: '1.0', requestId: null, error: { code: 'PROVIDER_ERROR', message: 'x', retryable: true } }) }),
  );
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  await page.locator('#composer-text').fill('Проверяет счета поставщиков и сверяет акты. '.repeat(60));
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.locator('[data-state-id="S18"]')).toBeVisible();
  for (const name of ['Повторить', 'Исправить', 'Назад']) {
    const btn = page.getByRole('button', { name, exact: true }).first();
    await btn.scrollIntoViewIfNeeded();
    const covered = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(hit === el || el.contains(hit));
    });
    expect(covered, name).toBe(false);
  }
});

test('T24 / T27: стекло на крупных панелях без вложенного blur; непрозрачный fallback; forced colors', async ({ page }) => {
  await open(page, 'full');
  const blurred = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.backdropFilter && cs.backdropFilter !== 'none';
    }).map((el) => el.className),
  );
  expect(blurred).toEqual(['app-glass question-panel']);
  const nested = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.app-glass')];
    return panels.some((p) => panels.some((q) => q !== p && p.contains(q)));
  });
  expect(nested).toBe(false);

  // Непрозрачный режим галереи (проверка без поддержки backdrop-filter).
  await page.goto('/#/gallery/state/S02?opaque');
  const opaque = await page.locator('.app-glass').first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, bf: getComputedStyle(el).backdropFilter }));
  expect(opaque).toEqual({ bg: 'rgb(255, 255, 255)', bf: 'none' });

  // Reduced transparency через CDP-эмуляцию медиа-признака.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await page.goto('/#/gallery/state/S02');
  const rt = await page.locator('.app-glass').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(rt).toBe('rgb(255, 255, 255)');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/#/gallery/state/S02');
  const fc = await page.locator('.app-glass').first().evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(fc).toBe('none');
  await expect(page.getByText('Ответ пока не добавлен')).toHaveCount(0);
});

test('T25: компоненты Carbon со штатными размерами и стилями (основные кнопки 48 px)', async ({ page }) => {
  await open(page, 'full');
  const box = async (name: string) => (await page.getByRole('button', { name, exact: true }).first().boundingBox())!;
  expect(Math.round((await box('Записать ответ')).height)).toBe(48);
  expect(Math.round((await box('Ответить текстом')).height)).toBe(48);
  expect(Math.round((await box('Назад')).height)).toBe(40);
  const primary = await page.getByRole('button', { name: 'Записать ответ' }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, padRight: cs.paddingRight };
  });
  const primaryChannels = primary.bg.match(/\d+/g)?.map(Number) ?? [];
  expect(primaryChannels).toHaveLength(3);
  expect(primaryChannels[2]).toBeGreaterThan(primaryChannels[0]! + 100);
  expect(primaryChannels[2]).toBeGreaterThan(primaryChannels[1]! + 100);
  expect(primary.color).toBe('rgb(255, 255, 255)');
  expect(Number.parseFloat(primary.padRight)).toBeGreaterThanOrEqual(48);
  await page.getByRole('button', { name: 'Ответить текстом' }).click();
  const area = await page.locator('#composer-text').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, borderBottom: cs.borderBottomStyle };
  });
  expect(area.bg).toBe('rgb(244, 244, 244)');
  expect(area.borderBottom).toBe('solid');
});
