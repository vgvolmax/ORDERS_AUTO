# ORDERS_AUTO Design Specification

**Date:** 2026-08-28  
**Status:** Approved basis for implementation  
**Primary JTBD:** Из двух отчётов 1С получить готовые заказы `подразделение → поставщик` с контролем MIN/MAX, минимальной суммы закупки и экспортом CSV/XLSX.

## 1. Context

Пользователь регулярно получает два отчёта: Min-Max по подразделениям и закупочную историю по поставщикам. Сейчас решения о закупках приходится собирать вручную. Приложение должно сократить эту работу до загрузки файлов, проверки исключений и выгрузки заказов.

Данные невелики: текущий Min-Max порядка 30k строк в иерархическом представлении. Multi-user и онлайн-доступ не требуются.

## 2. Approaches considered

### A. Client-only modular SPA + single-file production build — выбран

Исходники React/TypeScript, runtime полностью в браузере, итоговый artifact — один HTML.

Плюсы: нулевая инфраструктура, данные не покидают ПК, простой portable distribution, достаточная производительность. Минус: нет общей истории между компьютерами — она не требуется MVP.

### B. Local FastAPI/SQLite server

Плюсы: проще наращивать историю и интеграцию 1С. Минусы: bootstrap Python/server, localhost, больше точек отказа и сопровождения. Для текущего JTBD избыточно.

### C. Central backend

Плюсы: multi-user и централизованная история. Минусы: авторизация, hosting, безопасность данных, эксплуатация. Не соответствует текущим требованиям.

## 3. Architectural decision

Использовать вариант A. Development идёт как нормальный Vite-проект, но production собирается `vite-plugin-singlefile` в один `dist/index.html`. Сервер не является частью продукта.

Подробные неизменяемые правила находятся в:

- `docs/product/SPEC.md`
- `docs/data/DATA_CONTRACTS.md`
- `docs/ux/UX_AND_EXPORT.md`

## 4. Domain boundaries

### Import

Ответственность: превратить бинарные workbook buffers в нормализованные записи и validation issues. Import-код не рассчитывает закупочную потребность.

### Demand

Ответственность: для `SKU × branch` вычислить deficit/status и сетевые агрегаты. Не знает о React и IndexedDB.

### Supplier resolution

Ответственность: агрегировать supplier history, разрешить одного поставщика или зафиксировать blocker, рассчитать supplier unit cost.

### Orders

Ответственность: соединить demand + supplier resolution + ручные quantity edits + threshold settings в orders `branch × supplier`.

### Persistence

Ответственность: хранить только supplier overrides и пользовательские settings. Не является источником расчётных остатков.

### Export

Ответственность: сериализовать уже готовую order model в CSV/ZIP/XLSX. Экспорт не пересчитывает бизнес-логику самостоятельно.

### UI

Ответственность: показать projections, фильтровать, принимать ручные решения и вызывать domain/export APIs. React components не должны содержать дубли формул MIN/MAX.

## 5. Data flow

```text
Min-Max file ───────┐
                    ├─> parse/validate ─> normalized datasets
Supplier file ──────┘                         │
                                              ├─> demand engine
IndexedDB overrides/settings ─────────────────┼─> supplier resolution
Session qty edits ────────────────────────────┴─> order projection
                                                   │
                            ┌──────────────────────┼───────────────────┐
                            ↓                      ↓                   ↓
                         Demand UI            Orders UI            Export
```

## 6. Key decisions

1. Join only by 1C code.
2. Branch rows, not parent SKU totals, are source of truth for stock/MIN/MAX.
3. `stock < MIN` always overrides percentage color.
4. Multiple historical suppliers require manual confirmation; recommendation is informational.
5. Order price prefers weighted selected-supplier cost, then Min-Max reference price.
6. Threshold can apply to supplier network total or each branch-supplier order.
7. Orders below threshold stay in data and can be revealed; they are not silently discarded.
8. Missing supplier/price cannot be bypassed during export.
9. UI discovers branches dynamically; current nine are validation reference only.
10. Runtime makes no network requests.

## 7. Error handling

### Fatal import

Wrong workbook/structure or no useful records. Stay on Import screen.

### Row warnings

Bad norm, missing price, total mismatch, duplicate pair. Dataset continues; affected line can be excluded/block order.

### Supplier blockers

No supplier, multiple suppliers without manual choice, stale override.

### Export blockers

Unresolved supplier or missing price. Threshold can be consciously overridden only where explicitly allowed by UX spec.

## 8. UX structure

Screens after import:

- `Все` — network SKU view;
- one tab per discovered branch;
- `Поставщики` — supplier totals + supplier resolution;
- `Заказы` — supplier × branch matrix and editable order drawer.

Import is a separate initial state. Full requirements: `docs/ux/UX_AND_EXPORT.md`.

## 9. Test strategy

Testing pyramid:

1. Pure domain unit tests for boundaries and statuses.
2. Workbook parser integration tests using synthetic `.xls/.xlsx` buffers.
3. Export round-trip tests.
4. React integration tests for the main workflow.
5. Local manual smoke with real reports that are gitignored.

No production rule is accepted without a deterministic automated test where feasible.

## 10. Security/privacy

Repository is public. Real company reports must never be committed. Runtime is offline-first/local-only. No analytics, telemetry or remote fonts/CDNs.

## 11. Scope exclusions

Forecasting, dynamic MIN/MAX optimization, API integration with 1C, server history, auth, multi-user, email sending and approval workflows are deliberately outside MVP.

## 12. Success criteria

- user loads both reports without editing them;
- each valid branch SKU gets correct status and deficit;
- multiple/missing suppliers are visible and cannot disappear from order logic silently;
- threshold behavior is deterministic in both modes;
- each branch-supplier order can be inspected and quantity edited;
- CSV and supplier XLSX match order model;
- `npm run verify` passes;
- one `dist/index.html` runs from `file://` in Chrome/Edge.
