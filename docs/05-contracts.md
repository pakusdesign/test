# Контракты API

## Общие правила

Все JSON-ответы имеют schemaVersion: "1.0". Все операции обработки возвращают requestId и sessionRevision. Клиент генерирует requestId; сервер проверяет формат и возвращает его. HTTP неуспех имеет тело {schemaVersion, requestId, error: {code, message, retryable}}.

Ответ пользователя: {id, questionId: q1|q2|q3|q4, revision: integer>=1, text, active: boolean}. В анализ передаются только active=true. Snapshot: {sessionRevision, answers, confirmedFactIds}. Подтверждение хранится клиентом; сервер повторно проверяет факты и источники при генерации. Это локальный прототип без независимой серверной истории пользователя.

## Маршруты

| Метод и путь | Вход | Выход |
|---|---|---|
| GET /api/config | — | {schemaVersion, mode: demo|live, limits} |
| POST /api/transcribe | multipart: audio, requestId, sessionRevision, answerId | {schemaVersion, requestId, sessionRevision, answerId, text, language} |
| POST /api/analyze | {requestId, snapshot} | {schemaVersion, requestId, sessionRevision, analysis, completeness, questionStatuses} |
| POST /api/generate | {requestId, snapshot, analysis, confirmedFactIds} | {schemaVersion, requestId, sessionRevision, document} |

analysis соответствует contracts/analysis.schema.json. document соответствует contracts/vacancy.schema.json. Полноту и статусы сервер рассчитывает после проверки фактов. Клиент использует ту же чистую функцию при подтверждении и повторно сверяет результат перед генерацией.

Сервер выдаёт analysis с серверными ID фактов. Внутренние ID, предложенные моделью, переназначаются вместе со всеми ссылками. При generation сервер проверяет schemaVersion, ревизию, источники, зависимые факты, состояние единиц и принадлежность confirmedFactIds. Поля confirmation от модели игнорируются.

Создай Zod-схемы всех HTTP-запросов и ответов. Не ограничивай проверку TypeScript-типами. JSON Schema в комплекте описывает ответы моделей, а не полный HTTP API.

## Дополнительные инварианты

- Ровно восемь units с уникальными ID, даже если все missing.
- Все factIds, dependsOn и conflict.factIds существуют; циклы dependsOn запрещены.
- known и not_required требуют хотя бы один factId; missing и unknown не дают прогресс.
- not_required допустим только для q4.tools и q4.knowledge.
- Факт содержит хотя бы один источник с действительной цитатой.
- Ни один подтверждённый факт со старым источником не участвует в генерации.
- sourceFactIds результата ссылаются только на переданные подтверждённые факты.
- generated document содержит все обязательные разделы ровно один раз.
- JSON Schema не проверяет эти отношения; реализуй проверки в коде.

## Коды ошибок

| HTTP | code | Действие интерфейса |
|---|---|---|
| 400 | INVALID_REQUEST | Показать ошибку ввода |
| 413 | PAYLOAD_TOO_LARGE | Сократить запись или текст |
| 415 | UNSUPPORTED_AUDIO | Предложить текстовый ввод |
| 422 | NO_SPEECH | Повторить запись |
| 422 | INVALID_MODEL_OUTPUT | Повторить обработку; сохранить исходный текст |
| 422 | INSUFFICIENT_FACTS | Вернуться к ответам |
| 409 | STALE_REVISION | Не применять результат, повторить с актуальными данными |
| 429 | RATE_LIMITED | Показать задержку до повтора |
| 502 | PROVIDER_ERROR | Повторить или ввести текст |
| 503 | CONFIGURATION_ERROR | Сообщить о недоступном live |
| 504 | PROVIDER_TIMEOUT | Сохранить ответ и предложить повтор |

Сервер без состояния может выявить несовместимые версии внутри запроса. Устаревший ответ относительно текущего состояния вкладки отбрасывает клиент.

Не возвращай клиенту stack trace, тело ошибки провайдера или секреты.

## Состояние документа в клиенте

Храни generatedAtRevision, generatedDocument, editedDocument и isManuallyEdited. Ответ /generate не содержит флага «истинно»: система проверяет структуру и происхождение. При изменении sessionRevision помечай документ устаревшим. При успешном копировании показывай подтверждение; при отказе Clipboard API предложи выделить текст вручную.

Машиночитаемые примеры: fixtures/analysis.full.json и fixtures/vacancy.full.json. Их источники относятся к answers сценария full из cases.json: answerId a1–a4, revision 1.
