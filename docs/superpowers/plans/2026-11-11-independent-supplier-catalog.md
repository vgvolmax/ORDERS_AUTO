# Independent Supplier Catalog Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Execute inline; final whole-branch review.

**Goal:** Независимый справочник при сохранении исторических заказов.
**Architecture:** Отдельная ревизионная запись каталога, исторические снимки в workspace; атомарная запись вместе с изменяемым сеансом.
**Tech Stack:** Existing TypeScript/React/IndexedDB/Vitest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-11-independent-supplier-catalog-design.md

## Global Constraints
Офлайн file://; без новых зависимостей, backend и HTTP. Соединение только по полному коду 1С. Существующие расчёты/пул поставщиков неизменны. Не сливать PR.

## Review Focus
- Снятая связь не возвращается при миграции из более старой истории.
- Восстановленная копия не откатывает каталог и не меняет архивные заказы.
- Сбой записи и конфликт вкладки атомарно сохраняют предыдущие данные.
- Отсутствующий в текущем отчёте товар остаётся редактируемым.
- Новый код, нулевая история и оба порядка стартового импорта.

### Task 1: Домен, хранение и жизненный цикл
Files: create src/domain/supplierCatalog.ts, src/app/catalogSession.ts, src/persistence/supplierCatalog.ts; modify appState/initialState/App/workspaceSession and persistence db/workspaces. Tests: tests/domain/supplierCatalog.test.ts, tests/persistence/independentCatalog.test.ts.
Interfaces: SupplierCatalog содержит revision/products/assignments/source; createSupplierCatalog(data, history), mergeCatalogProducts(catalog, products), changeCatalogAssignment(catalog, command); loadOrCreateSupplierCatalog(active), loadSupplierCatalog(); WorkspaceSaveOptions.catalog = {expectedRevision, value}.
- [x] Написать тесты новой модели и полного lifecycle, запустить и увидеть отсутствие нового API (RED).
- [x] Реализовать чистые операции и миграцию из активного снимка, историю использовать только для identity.
- [x] Подключить каталог к очереди commit/restore и App, сохраняя исторические snapshots.
- [x] Проверить CAS/rollback, новые MIN/MAX после restore и отсутствие активного сеанса (GREEN).
- [x] Выполнить typecheck, все Vitest и сборку.

### Task 2: Каталог в UI и сквозная проверка
Files: SuppliersPage/SupplierProducts/SupplierRoster/SupplierAssignmentDialogs; ImportPage copy; docs product/data/architecture/UX/acceptance; tests UI and E2E-28.
Interfaces: UI использует state.catalog для редактирования и текущий MIN/MAX для присутствия/потребности. Текущие snapshot назначения остаются единственным входом расчётов заказов.
- [x] Написать тест отсутствующего товара/фильтра/сохранения и увидеть RED.
- [x] Подключить все товары каталога, фильтр и состояние присутствия, прежние controls/виртуализацию.
- [x] Добавить offline E2E: назначение → weekly import → исчезновение/редактирование → restore → новый MIN/MAX → reload → сверка старого заказа.
- [x] Обновить документы только по изменённым контрактам.
- [ ] Typecheck, полный Vitest, build, validate package, CI AppBox и Chrome E2E.

## Stop conditions
Изменение внешнего контракта/пула, необходимость runtime API или потеря исторических снимков требуют пересмотра решения. Ошибки тестов исправлять по причине, не ослаблять assertions.
