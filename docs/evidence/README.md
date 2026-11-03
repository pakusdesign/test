# Доказательства проверок

Собраны командами `npm run evidence` и `npm run check:contrast` в Chromium 153 (headless, Playwright 1.63.0), режим demo.

| Путь | Содержимое |
|---|---|
| `states/S01.png … S26.png` | Состояния интерфейса на настоящих экранах (галерея) |
| `states/N01.png … N10.png` | Сетевые состояния |
| `flow/` | Начало, запись, запись в demo, проверка, частичная полнота с уточнением, 100%, обзор с источником, результат, ручная правка |
| `viewports/` | Результат на 1024×768, 1280×720, 1440×900, 1920×1080; обзор на 1024, 1440 и 640 (масштаб 200%) |
| `ring-states.png`, `ring-states-reduced-motion.png` | Состояния круга (MOT07) |
| `ring-animation.webm` | Видео: заполнение 0→100, смена цели во время движения, ореол |
| `motion-metrics.json` | Интервалы кадров (headless; не равно 60 Hz реального экрана) |
| `components.png` | Компоненты Carbon в стеклянной панели |
| `opaque-fallback-S14.png`, `forced-colors-S05.png` | Непрозрачный fallback и forced colors |
| `contrast.json` | Контраст на итоговом фоне стекла |
| `live-eval.json` | Результат `npm run eval:live` (сейчас BLOCKED: нет ключей) |

Аудио, ключи и реальные ответы пользователей здесь не хранятся.
