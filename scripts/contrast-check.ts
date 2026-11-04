/**
 * Проверка контраста на итоговом фоне после смешивания прозрачных слоёв (DES05).
 * Худший участок: центр фонового пятна (максимальная насыщенность) под стеклом 0.78.
 * Размытие только усредняет фон, поэтому центр пятна — верхняя граница риска.
 * Запуск: npm run check:contrast → docs/evidence/contrast.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';

type RGB = [number, number, number];

const hex = (h: string): RGB => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as RGB;
const over = (fg: RGB, alpha: number, bg: RGB): RGB => fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as RGB;
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

const canvas = hex('#F4F7FC');
const blobBlue = over([120, 169, 255], 0.5, canvas);
const blobLilac = over([190, 149, 255], 0.42, canvas);
const white: RGB = [255, 255, 255];
const backgrounds: Record<string, RGB> = {
  'стекло над холстом': over(white, 0.78, canvas),
  'стекло над центром голубого пятна': over(white, 0.78, blobBlue),
  'стекло над центром сиреневого пятна': over(white, 0.78, blobLilac),
  'непрозрачный fallback': white,
};

const samples: { name: string; color: string; min: number }[] = [
  { name: 'Основной текст app-text-primary', color: '#161616', min: 4.5 },
  { name: 'Вторичный текст app-text-secondary', color: '#525252', min: 4.5 },
  { name: 'Акцент / ссылки app-accent', color: '#0F62FE', min: 4.5 },
  // Световое кольцо 2.0: чёткие дуги полноты (UNIT_STOPS) и насыщенная кромка обода (COLD/WARM_PALETTES).
  ...['#6040F0', '#5048F2', '#3156F6', '#1A60FF', '#0E86D0', '#08919F', '#1C7FE0', '#3D5FF0'].map((color) => ({
    name: `Дуга полноты ${color}`,
    color,
    min: 3,
  })),
  ...['#6A4CF5', '#2F67FF', '#0E9AA8', '#2A86F2', '#E2441E'].map((color) => ({ name: `Кромка обода ${color}`, color, min: 3 })),
  { name: 'Подпись уточнения (тёплый текст круга)', color: '#B83A17', min: 4.5 },
  { name: 'Знак 100% (support-success)', color: '#24A148', min: 3 },
  { name: 'Ошибка (text-error)', color: '#DA1E28', min: 4.5 },
];

const results = samples.flatMap((s) =>
  Object.entries(backgrounds).map(([bg, rgb]) => {
    const r = ratio(hex(s.color), rgb);
    return { element: s.name, background: bg, ratio: r, required: s.min, pass: r >= s.min };
  }),
);

mkdirSync('docs/evidence', { recursive: true });
const failed = results.filter((r) => !r.pass);
writeFileSync('docs/evidence/contrast.json', JSON.stringify({ date: new Date().toISOString(), results, failed: failed.length }, null, 2) + '\n');
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'FAIL'} ${r.ratio.toFixed(2)}:1 (≥${r.required}) ${r.element} — ${r.background}`);
if (failed.length > 0) process.exitCode = 1;
