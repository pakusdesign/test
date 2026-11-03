/**
 * Токены приложения (docs/10-design-system.md DES03, docs/12-progress-animation.md).
 * CSS-переменные объявлены в styles/_tokens.scss; тест tests/unit/tokens.test.ts
 * проверяет, что значения в SCSS и здесь совпадают.
 * Префикс app — собственные токены проекта, а не API Carbon.
 */
export const APP_TOKENS = {
  'app-canvas': '#F4F7FC',
  'app-glass-surface': 'rgba(255,255,255,0.78)',
  'app-glass-border': 'rgba(255,255,255,0.85)',
  'app-glass-blur': '20px',
  'app-glass-shadow': '0 12px 40px rgba(22,42,78,0.08)',
  'app-panel-radius': '20px',
  'app-solid-surface': '#FFFFFF',
  'app-text-primary': '#161616',
  'app-text-secondary': '#525252',
  'app-accent': '#0F62FE',
  'app-content-max': '1584px',
  'app-reading-max': '680px',
  // Фоновые пятна (статичные).
  'app-blob-blue': 'rgba(120,169,255,0.50)',
  'app-blob-lilac': 'rgba(190,149,255,0.42)',
} as const;

export const MOTION_TOKENS = {
  /** Проявление группы штрихов после подтверждения. */
  'motion-fill-duration': '400ms',
  'motion-fill-easing': 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Погашение группы при потере действительности. */
  'motion-drain-duration': '240ms',
  /** Появление и исчезновение ореола записи. */
  'motion-halo-fade': '120ms',
  /** Смена подписи этапа. */
  'motion-stage-label': '120ms',
  /** Знак завершения 100%. */
  'motion-success-fade': '180ms',
  /** Смена вопроса: opacity + translateY до 8px. */
  'motion-question-duration': '180ms',
  'motion-question-shift': '8px',
} as const;

/** Числовые значения для JS (задержки, тесты). Совпадают с MOTION_TOKENS. */
export const MOTION_MS = {
  fill: 400,
  drain: 240,
  haloFade: 120,
  stageLabel: 120,
  successFade: 180,
  question: 180,
  loadingDelay: 150,
  /** Сглаживание уровня голоса. */
  audioAttack: 60,
  audioRelease: 180,
} as const;

export const RING_SIZES = { regular: 220, compact: 200 } as const;
