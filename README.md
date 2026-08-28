# ORDERS_AUTO

Локальное HTML-приложение для подготовки заказов поставщикам на основании двух отчётов 1С:

1. `Min-Max.xlsx` — остатки и нормативы MIN/MAX по подразделениям.
2. отчёт по поставщикам (`.xls` / `.xlsx`) — исторические поставщики, количество и стоимость закупок по коду номенклатуры.

## Как запускать приложение

В корне репозитория есть один пользовательский запускаемый файл — **`ORDERS_AUTO.html`**.

Скачайте/распакуйте папку и откройте `ORDERS_AUTO.html` двойным кликом в актуальном Chrome или Edge. Node.js, npm, сервер и GitHub Actions для работы приложения не нужны.

Технический HTML-шаблон Vite находится внутри `src/app.html` и не является пользовательской точкой входа. Корневого `index.html` в репозитории нет.

## JTBD

> Из двух отчётов 1С за несколько минут получить проверяемый набор заказов вида **«подразделение → поставщик»**, отфильтровать экономически бессмысленные заказы и выгрузить готовые CSV/XLSX.

## Архитектура

- React + TypeScript + Vite.
- Полностью client-side: backend, сервер, БД и сетевые запросы в runtime не нужны.
- `npm run build` собирает один self-contained production HTML и обновляет корневой `ORDERS_AUTO.html`.
- CI проверяет, что закоммиченный `ORDERS_AUTO.html` совпадает со свежей сборкой, и реально открывает этот корневой файл через `file://` в Chrome.
- Реальные отчёты обрабатываются только локально в браузере.
- IndexedDB хранит только пользовательские настройки и ручные соответствия `Код 1С → поставщик`; исходные отчёты в репозиторий не коммитятся.

## Документация

- [`AGENTS.md`](AGENTS.md) — обязательные правила для Codex/агентов.
- [`CODEX_PROMPT.md`](CODEX_PROMPT.md) — готовый стартовый промпт для Codex.
- [`docs/product/SPEC.md`](docs/product/SPEC.md) — продуктовая спецификация и бизнес-правила.
- [`docs/data/DATA_CONTRACTS.md`](docs/data/DATA_CONTRACTS.md) — форматы импорта, нормализация и базовые доменные типы.
- [`docs/data/DERIVED_PROJECTIONS.md`](docs/data/DERIVED_PROJECTIONS.md) — денежная потребность, unresolved demand и вычисляемые представления.
- [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) — техническая архитектура и границы модулей.
- [`docs/ux/UX_AND_EXPORT.md`](docs/ux/UX_AND_EXPORT.md) — экраны, фильтры, состояния и экспорт.
- [`docs/testing/ACCEPTANCE_CRITERIA.md`](docs/testing/ACCEPTANCE_CRITERIA.md) — критерии приёмки и контрольные кейсы.
- [`docs/superpowers/specs/2026-08-28-orders-auto-design.md`](docs/superpowers/specs/2026-08-28-orders-auto-design.md) — утверждённый design spec.
- [`docs/superpowers/plans/2026-08-28-orders-auto-implementation.md`](docs/superpowers/plans/2026-08-28-orders-auto-implementation.md) — пошаговый implementation plan.
- [`docs/superpowers/plans/2026-08-28-production-hardening.md`](docs/superpowers/plans/2026-08-28-production-hardening.md) — hardening-план offline/release контура.

## Важное о тестовых данных

Репозиторий публичный. Реальные отчёты компании не должны попадать в git. Для локальной smoke-проверки положите файлы в `samples/private/`; эта папка игнорируется git. Unit/integration tests обязаны генерировать синтетические `.xlsx`/`.xls` fixtures программно.

## Definition of Done

Приложение считается готовым, когда `npm run verify` проходит полностью, `npm run build` обновляет корневой `ORDERS_AUTO.html`, CI подтверждает, что в корне ровно один HTML-файл — `ORDERS_AUTO.html` — и успешно открывает его через `file://` в Chrome, а сценарий `импорт → потребность → поставщики → заказы → CSV/XLSX` проходит на синтетических fixtures и на реальных локальных отчётах без ручного изменения исходных файлов.
