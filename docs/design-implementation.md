# Дизайн: реализация и проверка

Требования: [10-design-system.md](10-design-system.md), [11-interface-states.md](11-interface-states.md), [12-progress-animation.md](12-progress-animation.md).

## Carbon

- Пакеты: `@carbon/react` 1.119.0 (стили `@carbon/styles` 1.118+), `@carbon/icons-react` 11.91.0. Вторая UI-библиотека не используется.
- Тема: основа White. Через токены изменены только `background` = `#F4F7FC` (app-canvas), `layer-01` = `#FFFFFF` (непрозрачные вложенные карточки), `layer-hover-01` = `#F2F5FA` (`src/client/styles/carbon.scss`). Остальные семантические токены (текст, фокус, статусы, границы, disabled) — из White без изменений. Токены темы выводятся на `:root`.
- Шрифт: IBM Plex Sans 400/600 из `@fontsource/ibm-plex-sans` (latin, latin-ext, cyrillic, cyrillic-ext), загрузка локальная. `@font-face` Carbon (CDN) отключён (`$css--font-face: false`).
- Используемые компоненты: Button, IconButton, TextArea, TextInput, Select, Checkbox, Toggle (галерея), Tag, InlineNotification, ActionableNotification, ToastNotification, InlineLoading, SkeletonText, Accordion, Modal, Tooltip, Grid/Column.
- Карточки, `<details>` с requestId и шаги навигации — собственные контейнеры приложения. DOM и клавиатурная модель Carbon не менялись, внутренние классы Carbon не переопределены. Единственное исключение — `max-width: none` у уведомлений внутри панелей приложения: Carbon ограничивает ширину уведомлений, а в узких панелях оно должно занимать ширину контейнера.

| Типографика (DES03) | Токен Carbon | Значение |
|---|---|---|
| Основной текст | `body-02` | 16/24 |
| Подписи | `body-01` | 14/20 |
| Заголовок вопроса | `heading-04` | 28/36 |
| Крупный заголовок | `heading-05` | 32/40 (процент в круге, заголовки экранов) |

## Токены приложения

Источник: `src/client/styles/_tokens.scss`, зеркало для JS и тестов — `src/client/styles/tokens.ts`. Совпадение проверяет `tests/unit/ring.test.ts`.

| Токен | Значение |
|---|---|
| app-canvas | #F4F7FC |
| app-glass-surface | rgba(255,255,255,0.78) |
| app-glass-border | rgba(255,255,255,0.85) |
| app-glass-blur | 20px |
| app-glass-shadow | 0 12px 40px rgba(22,42,78,0.08) |
| app-panel-radius | 20px |
| app-solid-surface | #FFFFFF |
| app-text-primary / secondary | #161616 / #525252 |
| app-accent | #0F62FE |
| app-content-max / reading-max | 1584px / 680px |
| app-blob-blue / lilac | rgba(120,169,255,0.50) / rgba(190,149,255,0.42) — статичные пятна |
| motion-fill-duration / easing | 400ms / cubic-bezier(0.22, 1, 0.36, 1) |
| motion-drain-duration | 240ms |
| motion-halo-fade, motion-stage-label | 120ms |
| motion-success-fade, motion-question-duration | 180ms; смещение вопроса 8px |

## Собственные компоненты

| Компонент | Файл | Назначение |
|---|---|---|
| VacancyProgressRing | `src/client/components/ring/VacancyProgressRing.tsx` | 64 штриха, 8 групп-масок, ореол, ожидание, доступность |
| SessionRing | `src/client/components/SessionRing.tsx` | Связь круга с состоянием сессии |
| GlassPanel | `src/client/components/common.tsx` | Стеклянный контейнер крупной панели |
| ActionErrorNotice, SlowNotice, EmptyState, SectionBoundary | `src/client/components/common.tsx` | Ошибки, S15, пустые состояния, S25 |
| ConnectionBanner | `src/client/components/ConnectionBanner.tsx` | N01, N06, N07 |

## Стекло и fallback

- Стекло только на крупных панелях: панель вопроса, обзор, боковая панель, результат, старт. Вложенного blur нет; проверено в e2e (`T24 / T27`).
- Нет `backdrop-filter` → `@supports not (...)` → `app-solid-surface` с границей. Проверка в галерее: `#/gallery/state/<ID>?opaque` или переключатель «Непрозрачный fallback стекла».
- `prefers-reduced-transparency: reduce` → непрозрачная панель (проверено эмуляцией CDP в Chromium).
- `forced-colors: active` → `Canvas`, `CanvasText`, `Highlight`; blur отключён (скриншот `docs/evidence/forced-colors-S05.png`).

## Desktop-адаптация

| Ширина | Поведение | Проверка |
|---|---|---|
| < 1024 | Одна колонка, перенос кнопок, вертикальная прокрутка; без экрана «откройте на компьютере» | e2e: 640 px (масштаб 200%) |
| 1024–1055 | Поля 24 px, круг 200 px, одна колонка | e2e: 1024×768, порог 1055/1056 |
| 1056–1311 | Поля 32 px, круг 220 px; обзор и результат — панели одна под другой | e2e: порог 1311/1312 |
| 1312–1583 | Обзор и результат: 10 + 6 колонок Carbon Grid | e2e: 1312, 1440×900 |
| ≥ 1584 | Сетка не шире 1584 px, растут поля | e2e: 1585 и 1920 дают одинаковую ширину сетки |

Высота 720 px с длинной расшифровкой и ошибкой: действия доступны прокруткой и не перекрыты (e2e).

## Контраст (DES05)

`npm run check:contrast` → `docs/evidence/contrast.json`. Худший участок — центр фонового пятна под стеклом 0.78. Все 28 проверок проходят. Минимальные значения: акцент и ошибка — 4.56:1 (норма 4.5), пустые штрихи круга — 3.02:1 (норма 3), знак 100% — 3.05:1. Запас у акцента и штрихов небольшой. Если увеличить насыщенность пятен, нужно поднять непрозрачность стекла.

## Проверенные viewport и браузеры

- Chromium 153.0.8010.12 (Playwright 1.63.0, headless, Linux): 1024×768, 1280×720, 1280×800, 1440×900, 1920×1080, 640×400; пороги 1055/1056, 1311/1312, 1583/1585.
- Safari и Chrome на macOS не проверялись: в облачной среде есть только Chromium. Нужна ручная проверка (см. `docs/test-report.md`).

## Матрица состояний

Галерея: `npm run dev` → `http://127.0.0.1:5173/#/gallery`, состояние — `#/gallery/state/<ID>`. Скриншоты: `docs/evidence/states/<ID>.png`.

| ID | Где реализовано | Автотест |
|---|---|---|
| S01 | `screens/StartScreen.tsx` | main-path S09 |
| S02 | `QuestionScreen.tsx` → FirstAnswer | recording S10 |
| S03 | `controller.ts` submitComposer/checkAnswer | semantics S03 |
| S04 | `messages.ts` NO_SPEECH, пустая запись в controller | recording T03/S04 |
| S05 | FactsCard + ClarificationPanel | semantics T06 |
| S06 | `OverviewScreen.tsx` EmptyState | semantics T12 |
| S07 | `ResultScreen.tsx` пустой раздел | semantics T12 |
| S08 | `ResultScreen.tsx` gaps пуст | только галерея (при текущих правилах gaps всегда содержит должность и условия) |
| S09 | `transitions.ts` resetSession + Modal | main-path S09 |
| S10 | PermissionPanel | recording S10 |
| S11 | `messages.ts` micError | recording T02 |
| S12 | micError / StartAnswerButtons | recording S12 |
| S13 | `recorder.ts` track.onended → RecordedPanel | галерея; unit (запись прерывания — вручную) |
| S14 | SessionRing processing + ProcessingControls | network T17 |
| S15 | SlowNotice | network S15/N09 |
| S16 | Composer invalid + лимит записи | semantics S16, recording T03 |
| S17 | `messages.ts` RATE_LIMITED | network T15, integration |
| S18 | PROVIDER_ERROR | network T32 |
| S19 | PROVIDER_TIMEOUT / клиентский тайм-аут | network T15, integration |
| S20 | INVALID_MODEL_OUTPUT / проверка клиента | network T16, integration |
| S21 | ConflictPanel | semantics T09 |
| S22 | ResultScreen stale + Modal export_stale | main-path S22 |
| S23 | doCopy → «Выделить текст», скачивание | network S23 |
| S24 | StartScreen + CONFIGURATION_ERROR | network S24 |
| S25 | SectionBoundary | галерея (компонент бросает ошибку) |
| S26 | ConfigErrorScreen | network S26 |
| N01 | ConnectionBanner | network N06/N01 |
| N02 | RecordingPanel | network T30 |
| N03 | postForm (upload не завершён) | network T30 |
| N04 | postJson / postForm после отправки | network N04 |
| N05 | generate network | network N05 |
| N06 | ConnectionBanner на результате | network N06 |
| N07 | ConnectionBanner recovered | network T30 |
| N08 | applyAnalysis / applyDocument сбрасывают ошибку | network T30, N04 |
| N09 | ожидание → S15 → S19 | network S15/N09 |
| N10 | Граница: без сети приложение не загружается; PWA вне объёма | галерея (пояснение) |

## Анимация (MOT01–MOT12)

| ID | Реализация | Проверка |
|---|---|---|
| MOT01 | Три независимых источника: `validConfirmedUnits`, `audioMeter`, `processing` | unit ring-component T35 |
| MOT02 | `geometry.ts`: viewBox 220, штрих r 88–98, ширина 2, 84°+6°, старт −87°+90°q, ореол r 104 | unit ring.test |
| MOT03 | Вход — 8 булевых значений; процент вычисляется из них; Math.round | unit, e2e T34 |
| MOT04 | Маска на группу, `stroke-dashoffset` 400 ms; снижение 240 ms; группы одновременно | e2e T33 (WAAPI-тайминг) |
| MOT05 | Web Audio RMS → дБ → 0…1, attack 60 / release 180 ms; scale 1+0.03l, opacity 0.2+0.3l | unit, e2e «ореол от реального сигнала» |
| MOT06 | Один InlineLoading после 150 ms, подпись сразу, круг неподвижен | unit, e2e T35/T38 |
| MOT07 | Статусы под кругом по этапам | галерея, скриншоты flow |
| MOT08 | Знак 100% после заполнения, отмена при переходе, без повтора эффекта | unit ring-component |
| MOT09 | Продолжение от текущего значения; скрытая вкладка — без переходов; очистка ресурсов | e2e T36, T01 (треки остановлены) |
| MOT10 | role=progressbar, aria-valuetext, одно объявление, reduced motion, forced colors | unit, e2e T18/T37, axe |
| MOT11 | Контрольный сценарий | e2e main-path, motion T37 |
| MOT12 | Галерея, стенд с ползунком уровня, видео `docs/evidence/ring-animation.webm`, замеры `motion-metrics.json` | evidence |
