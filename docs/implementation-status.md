# Журнал реализации

Документ для следующего агента. Ключи, аудио и реальные ответы пользователей здесь не хранятся.

Спецификация комплекта (docs/01–12, contracts, prompts, fixtures, CLAUDE.md, START_HERE.md) не изменялась. Исходный README комплекта сохранён как `KIT_README.md`, а `README.md` — README разработчика.

**Итог: готов demo, live не подтверждён.** Отчёт проверок: [test-report.md](test-report.md). Решения и расхождения: [decisions-implementation.md](decisions-implementation.md). Дизайн: [design-implementation.md](design-implementation.md).

## P0. Репозиторий, версии, журнал решений — done

- **Сделано.** Git-репозитория в выбранных папках не было, поэтому проект создан как `vacancy-brief/` с копией комплекта v1.2.
- **Версии.** Node 22.23.4 (`.nvmrc` = 22). Точные версии: React 19.3.1, TypeScript 6.0.3, Vite 8.3.5, @carbon/react 1.119.0, @carbon/icons-react 11.91.0, Express 5.3.0, multer 2.5.0, Zod 4.6.7, Vitest 5.1.0, Playwright 1.63.0, ESLint 10.14.0.
- **Решения:** I01–I05 в `decisions-implementation.md`.

## P1. Приложение, сервер, схемы, demo, Carbon и токены — done

- **Файлы:** `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `playwright.config.ts`, `.env.example`, `src/shared/*`, `src/server/*`, `src/client/styles/*`.
- **Сервер.** Маршруты `/api/config`, `/api/transcribe`, `/api/analyze`, `/api/generate`. Zod-схемы всех HTTP-запросов и ответов. Лимиты срабатывают до вызова провайдера. Ограничение частоты в live, логи по белому списку полей.
- **Провайдеры.** Demo: каталог фиксированных результатов, шаблон генерации. Live: Deepgram (nova-3, ru) и Anthropic (`output_config.format`, json_schema). Без ключей — `CONFIGURATION_ERROR`.
- **Запуск:** `npm run dev`. Режим виден в шапке и в `/api/config`.

## P2. Полнота и проверка источников — done

- **Файлы:** `src/shared/completeness.ts`, `validation.ts`, `gaps.ts`, `src/server/factIds.ts`.
- **Отображение единиц на группы штрихов:** порядок `UNIT_IDS`, группа k = штрихи 8k…8k+7 (`components/ring/geometry.ts`).
- **Проверка.** Unit-тесты: 0, 12.5, 50 и 100%, разреженное заполнение, unknown, not_required только для q4, conflict, инвалидация по ревизии, зависимость q3 от q2, superseded, чужая цитата, несуществующий factId, цикл, выдуманные условия, подмена ID.

## P3. Текстовый путь через четыре вопроса и обзор — done

- **Файлы:** `src/client/state/{types,store,transitions,controller,messages}.ts`, `screens/{Start,Question,Overview}Screen.tsx`, `components/*`.
- **Возможности.** Можно исправить, подтвердить, исключить факт и пропустить ответ. Есть уточнения (не больше двух) и разрешение противоречий. Нулевые и пустые состояния S01–S09.
- **Проверка:** e2e `semantics.spec.ts`, unit `transitions.test.ts`.

## P4. MediaRecorder, визуализатор, STT — done (live: blocked)

- **Файлы:** `src/client/audio/{recorder,level}.ts`, `api/http.ts` (XHR для N03/N04), `src/server/providers/deepgram.ts`.
- **Возможности.** Запрос микрофона только по нажатию. Выбор MIME. Отказ, отсутствие устройства, потеря трека, лимиты 120 с и 10 МБ. Финальный `dataavailable` перед отправкой. Все ресурсы освобождаются. Ореол от Web Audio.
- **Проверка.** e2e `recording.spec.ts`: фиктивное устройство Chromium, T01–T03, S10–S13. Integration: адаптер Deepgram на подменённом fetch.
- **Блок.** Реальный русский ответ через Deepgram не проверен: нет `DEEPGRAM_API_KEY`. Для проверки готовы синтетические примеры `tests/evals/audio/` и `npm run eval:live`.

## P5. Live-анализ, уточнения, подтверждение — done (live: blocked)

- **Файлы:** `src/server/pipeline.ts`, `prompts.ts`, `providers/anthropic.ts`.
- **Возможности.** Схема для модели без неподдерживаемых ограничений. Один repair-вызов. Повтор 429/5xx внутри бюджета 45 с. Серверные ID фактов.
- **Проверка.** Integration `api.test.ts`, `providers.test.ts`: T13, T15, T16, форма запроса Anthropic. Demo-конвейер по всем случаям `cases.json` (`demo-pipeline.test.ts`).
- **Блок.** Качество извлечения live-моделью не измерено: нет `ANTHROPIC_API_KEY` и `LLM_MODEL`.

## P6. Генерация, редактор, экспорт — done (live: blocked)

- **Файлы:** `screens/ResultScreen.tsx`, `src/shared/markdown.ts`.
- **Возможности.** Проверка документа: разделы, `sourceFactIds`, заголовок, выдуманные условия. Серверные пробелы. Отметка «Изменено вручную». Устаревание документа, модальные окна замены и экспорта устаревшего текста. Копирование и fallback S23, скачивание `vacancy-description.md`.
- **Проверка:** e2e `main-path.spec.ts` (T11, T14, T23, S22), integration T11–T13.

## P7. Круг, glassmorphism, desktop-адаптивность, галерея — done

- **Файлы:** `components/ring/*`, `styles/{_ring,_app,_tokens,carbon}.scss`, `gallery/{Gallery,presets}.tsx`.
- **Проверка.** e2e `motion.spec.ts`: T33–T38 через WAAPI и rAF в странице. `a11y-layout.spec.ts`: T18, T24–T27, axe. Галерея S01–S26, N01–N10 и MOT07. Контраст 28/28.
- **Исправлено по итогам проверок:** N07 после `online` (U04). CSS Carbon сокращён до используемых модулей (S01); регрессия размеров кнопок из-за пропущенного модуля `layout` найдена по скриншотам, исправлена и закрыта тестом T25. Повтор той же задачи больше не заполняет `q1.task2`.

## P8. Проверки, README, демонстрация — done (live: blocked)

- **Результаты.** typecheck и lint без ошибок. Unit 76/76, integration 61/61, e2e 54/54, evidence 3/3. Сборка и smoke `npm start` пройдены. `eval:live` — BLOCKED.
- **Документы:** `README.md`, `docs/test-report.md`, `docs/demo-script.md`, `docs/decisions-implementation.md`, `docs/design-implementation.md`, `docs/evidence/*`.

## Следующая задача

1. Заполнить `.env` (APP_MODE=live, ключи, LLM_MODEL), выполнить `npm run eval:live` и записать модель, дату, результаты трёх прогонов и пример ошибки в этот журнал и в `test-report.md`.
2. Ручная проверка в Chrome и Safari на macOS с реальным микрофоном. Записать версии браузеров, откалибровать порог тишины (`src/client/audio/level.ts`), сделать запись производительности 10 с.
3. Smoke со screen reader (VoiceOver).
4. Если live-модель меняет формулировки между анализами и подтверждения теряются, рассмотреть перенос ID на канонические источники без текста (`factIds.ts`) и повторное использование подтверждённого текста.

## Доработка Codex после ревью — 3 ноября 2026

Исправлены F01/F02; добавлены controller-race.test.ts и normalized-analysis.test.ts. Уточнены engines, инструкция запуска и выбор канала Playwright. Добавлен CI и docs/submission. Повторная проверка: docs/final-test-report.md. Подготовлены видео и презентация для пользователя. Live и публикация остаются заблокированы отсутствующими настройками и URL репозитория.

## Световое кольцо 2.0 — 4 ноября 2026

**Задача пользователя:** заменить 64 штриха светящимся кольцом по «Редакции движения 2.0» (MOT01–MOT12), референсы — видео 88476fd44a47341a7c3bdf0da16b50f6_720w.mp4 и изображение с дугой «01».

**Конфликт требований (записан до изменения поведения).** `CLAUDE.md`, раздел «Анимация версии 1.2», и `docs/12-progress-animation.md` версии 1.2 требуют 64 радиальных штриха и ореол. Задача пользователя и приложенная спецификация 2.0 прямо заменяют дорожку из 64 штрихов световой поверхностью. Выполнено по задаче пользователя. Файлы `CLAUDE.md` и `docs/12-progress-animation.md` не менялись и описывают прежнюю версию: следующему агенту не возвращать штрихи.

- **Изменённые файлы:** `src/client/components/ring/VacancyProgressRing.tsx`, `ring/geometry.ts`, новый `ring/lightRenderer.ts`, `src/client/styles/_ring.scss`, `src/client/components/SessionRing.tsx`, `src/client/gallery/Gallery.tsx`, `scripts/contrast-check.ts`, тесты `tests/unit/ring.test.ts`, `tests/unit/ring-component.test.tsx`, `tests/e2e/{helpers,motion.spec,recording.spec,a11y-layout.spec}.ts`, `tests/evidence/evidence.spec.ts`.
- **Слои.** Canvas (декоративный): четыре заранее размытых световых поля (поворот и прозрачность в кадре), обод 2,5 px, лента записи 12 px с двумя волнами, тёплая пульсация. SVG (чёткий): 8 дуг полноты по 45°, переход 400 ms / 240 ms через stroke-dashoffset. Центр и подписи — без изменений, кроме строк статуса под кругом.
- **Источники состояния (MOT09).** Полнота — `validConfirmedUnits`. Предупреждение — `clarification[q].activeUnit !== null` (приложение предложило уточнение по результату анализа актуальной версии непустого ответа). Запись — `stage === 'recording'` (ставится после `recorder.start()`), уровень — `AudioMeter`. Логика анализа, уточнений и навигации не менялась. Следствие: при частичных фактах тёплая зона появляется после «Подтвердить сведения» (так устроено предложение уточнения в приложении); при ответе без фактов — сразу после анализа.
- **Подписи.** «Идёт запись · вопрос N из 4», «Записываем уточнение», «Вопрос N · нужно уточнение» + текст уточнения, отдельная строка «Нужно уточнение: вопрос N» для других вопросов. Объявления: процент и появление уточнения; кадры и уровень звука не объявляются.
- **Производительность.** Цикл rAF только при видимой вкладке, круге в зоне видимости и без reduced motion; подписки снимаются при размонтировании. Reduced motion — один статичный кадр.
- **Проверки:** см. итог в `docs/evidence/ring-2.0/README.md`.
- **Ограничения.** Замер кадров сделан в headless Chromium в облачном контейнере без GPU; на Mac и в Safari не измерялось. Холст использует `createConicGradient` (Chrome 99+, Safari 16.1+, Firefox 112+), для старых браузеров есть упрощённый путь отрисовки сегментами.

**Следующая задача:** замер 10 с в Chrome и Safari на Mac с реальным микрофоном (Performance panel), калибровка порога тишины; решить, обновить ли `docs/12-progress-animation.md` и `CLAUDE.md` до редакции 2.0.
