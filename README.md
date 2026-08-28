# ORDERS_AUTO

Локальное HTML-приложение для подготовки заказов поставщикам на основании двух отчётов 1С:

1. `Min-Max.xlsx` — остатки и нормативы MIN/MAX по подразделениям.
2. отчёт по поставщикам (`.xls` / `.xlsx`) — исторические поставщики, количество и стоимость закупок по коду номенклатуры.

## Как запускать готовое приложение

Пользовательский файл — **`ORDERS_AUTO.html` из GitHub Actions/Release**. Распакуйте artifact `ORDERS_AUTO-preview` и откройте `ORDERS_AUTO.html` двойным кликом в актуальном Chrome или Edge. Node.js, npm и локальный сервер для работы приложения не нужны.

> **Не открывайте корневой `index.html` из ZIP исходников репозитория как готовое приложение.** Это Vite entrypoint для разработки; production-файл создаётся командой `npm run build` как `dist/index.html`, а CI публикует его пользователю под однозначным именем `ORDERS_AUTO.html`.

## JTBD

> Из двух отчётов 1С за несколько минут получить проверяемый набор заказов вида **«подразделение → поставщик»**, отфильтровать экономически бессмысленные заказы и выгрузить готовые CSV/XLSX.

## Архитектура

- React + TypeScript + Vite.
- Полностью client-side: backend, сервер, БД и сетевые запросы в runtime не нужны.
- Production build собирается в один самодостаточный `dist/index.html` и проверяется настоящим Chrome при открытии через `file://`.
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

Приложение считается готовым, когда `npm run verify` проходит полностью, `npm run build` создаёт один `dist/index.html`, CI успешно открывает его через `file://` в Chrome, а сценарий `импорт → потребность → поставщики → заказы → CSV/XLSX` проходит на синтетических fixtures и на реальных локальных отчётах без ручного изменения исходных файлов.
