# Current catalog and accepted documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Фиксировать принятые строки и использовать текущий справочник во всех рабочих периодах.
**Architecture:** Аддитивный снимок в существующем accepted ledger; единый владелец применения live-каталога к сеансу. UI и экспорты используют прежнюю проекцию документов.
**Tech Stack:** TypeScript strict, React, IndexedDB, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-12-current-catalog-accepted-documents-design.md

## Global Constraints
- file://, без backend, внешних runtime-запросов и новых зависимостей.
- Join только по полному коду 1С; цены из MIN/MAX выбранной недели.
- Новый PR не сливать. Существующий статус принятия относится к перемещениям.

## Review Focus
- Legacy accepted без снимка: зафиксировать до применения текущего каталога.
- null/0: неизвестное не заменять нулём или текущей ценой.
- Смешанные направления: экспортировать только принятые строки с их историческими названиями/единицами.
- Архивная сверка: сбрасывать устаревшую проверку и блокировать выгрузку при изменении ревизии каталога.
- Ошибка записи: не публиковать новые справочные данные или снимки до успешной транзакции.

### Task 1: Снимок принятой строки
Files: domain/rebalancing/types.ts, app/acceptedDocumentContext.ts, app/rebalanceActions.ts, features/rebalancing/transferDocuments.ts; tests/domain/acceptedDocumentContext.test.ts.
Consumes: AppState и AcceptedTransfer[]. Produces: freezeAcceptedDocuments(state, accepted): AcceptedTransfer[]; optional AcceptedTransfer.document.
- [ ] RED: после принятия изменение единиц/цены/названия не меняет принятый документ и CSV/XLSX; соседнее предложение обновляется; null и 0 сохраняются; revoke/reaccept захватывает новые данные.
- [ ] GREEN: захват в prepareAcceptedChange, чтение снимка в проекции; legacy fallback сохранён до миграции.
- [ ] Run targeted tests, typecheck, full tests/build; commit.

### Task 2: Текущий каталог во всех рабочих периодах
Files: app/catalogSession.ts, app/selectors.ts, app/quantityPolicies.ts, app/workspaceSession.ts, domain/supplierAssignments.ts, features/invoices/useInvoiceOrders.ts; persistence/UI regression tests.
Consumes: текущий SupplierCatalog, сохранённый WorkspaceData, frozen accepted. Produces: рабочая копия с актуальными assignments/context и адресно снятыми отметками заказов.
- [ ] RED: старую неделю восстановить после смены общего справочника; назначения/единицы актуальны, принятые документы неизменны; правка из старой недели видна следующей и восстановленной новой.
- [ ] RED: архивная сверка обновляется при смене каталога; stale revision запрещает экспорт; неуспешный save не публикует контекст.
- [ ] GREEN: применить каталог в существующем lifecycle; сначала сохранить legacy accepted context; архивный hook использует тот же владелец.
- [ ] Обновить изменившиеся исторические ожидания тестов по новой спецификации; выполнить полный typecheck/tests/build и commit.

### Task 3: Браузерная проверка и PR
Files: tests/e2e/acceptedCatalog.ts, tests/e2e/offline.spec.ts; maintained product/data/architecture/UX/testing docs.
- [ ] Chrome file://: принять часть перемещений, обновить JSON, восстановить неделю, проверить неизменные принятые и актуальные непринятые; CSV/XLSX; перезагрузка и отмена принятия. Снимки экранов.
- [ ] Полный CI: typecheck, все тесты, production build, воспроизводимость, AppBox упаковка/smoke, все E2E.
- [ ] Отдельное ревью всей ветки, исправление важных замечаний с RED→GREEN.
- [ ] Создать новый PR от merged main и оставить без слияния.

Stop conditions: несовпадающий upstream-контракт, необходимость backend/shared SDK или отдельного проведения закупочных заказов — вне этой реализации.
