# Operator Workflow Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать настройку кратности и сделать товарные списки/приём перемещений понятными оператору.
**Architecture:** Сохраняем чистый домен, добавляем автоматическую app-политику шага1 и общие товарные колонки; UI использует существующие VirtualTable/Dialog и durable workspace queue. Импорт форматирует только кодовые ячейки, не меняя числовые показатели.
**Tech Stack:** TypeScript, React, SheetJS, Vitest, Playwright Chrome file://.
**Spec:** docs/superpowers/specs/2026-10-30-operator-workflow-polish-design.md

## Global Constraints

- Шаг новых перемещений1; нет ручного окна кратности/единиц.
- Не терять принятые движения; закупка учитывает только accepted.
- Полный Код1С, join только по нему; Код → Артикул → Наименование.
- Offline file://; не менять production dependencies; не мержить.

## Review Focus

- Код в числовой форматированной ячейке и в текстовом виде в другом отчёте должен совпадать: Task1.
- Исторический accepted с нестандартной политикой сохраняется; новые настройки не должны ломать ledger: Task2.
- Длинный состав, поиск и выбор за пределами viewport; действия доступны при1280×600: Task3.
- При отказе принятия карточка остаётся; после сохранения закрывается, orders/CSV соответствуют: Task3.
- Длинные коды, пустые артикулы и имена во всех товарных таблицах: Task4.

### Task1: Полные идентификаторы при импорте

**Files:** src/import/workbook.ts; minMaxParser.ts; supplierParser.ts; tests/import/productCodes.test.ts.
**Interfaces:** readFirstSheetRows(input:ArrayBuffer):unknown[][] retains raw numbers except code-column cells resolved from visible cell text.
- [ ] Написать тесты: numeric123 format000000→000123 в обоих отчётах; text000123 неизменен; stock1.5/price1000 числовые.
- [ ] Запустить тесты, увидеть потерю нулей.
- [ ] Реализовать форматирование только кодовых колонок, проверить потребность/поставщика/экспорт по000123.
- [ ] Прогнать import suite; commit.

### Task2: Автоматический шаг1 и единицы

**Files:** app/selectors.ts; app/quantityPolicies.ts(new); rebalancing/ConditionsPanel.tsx; RebalancingPage.tsx; AcceptedMovementsPopover.tsx; tests/ui/automaticRebalancePolicies.test.tsx.
**Interfaces:** DerivedState.quantityPolicies:SkuQuantityPolicy[]; resolve policies from imported SKU/history with quantityStep1, legacy accepted compatibility.
- [ ] Тест: без saved policies calculate предлагает движения; UI не содержит формы шага; известная единица отображается, «1» не становится единицей; legacy accepted сохранён.
- [ ] RED → минимальная app-политика, убрать настройку и мёртвый setter → GREEN.
- [ ] Прогнать domain/app/UI tests; commit.

### Task3: Прокрутка состава и завершение принятия

**Files:** TransferDrawer.tsx; ResultsTable.tsx; RebalancingPage.tsx; VirtualTable.tsx if necessary; styles/app.css; transferInspector/acceptance tests; offline.spec.ts.
**Interfaces:** acceptance success signal is published only after durable commit; ResultsTable closes its opened document once on successful accept, not on pending/failure/revoke.
- [ ] Тест: нет pagination, выбор всех filtered rows; принятие closes composition on success only; failure retains UI.
- [ ] RED → bounded virtual scroll, explicit quantity/unit columns, opaque sticky layer, durable success signal → GREEN.
- [ ] Native E2E: scroll last of130 rows; search/select; visible actions at1280×600/1024; no document overflow; sticky occlusion; accepted CSV; success/failure.
- [ ] Прогнать inspector/queue/acceptance tests; commit.

### Task4: Единый порядок и полный товарный контекст

**Files:** shared productColumns helper; demand/orders/suppliers/rebalancing product tables; tests/ui/productColumns.test.tsx; UX/primary contracts.
**Interfaces:** shared productColumns<T>(identity:(row:T)=>{code,article,name}):VirtualColumn<T>[] (code/article/name), supports table-specific rendering/widths through explicit overrides.
- [ ] Тест: first business headers Код/Артикул/Наименование; supplier decision includes all identity fields and search; long code retained.
- [ ] RED → reuse shared helper, reorder native tables where already correct preserve; add identity to movements/accept preview/skipped lists → GREEN.
- [ ] Обновить binding docs новым правилом; typecheck/full tests/build/static audit/native Chrome CI; whole-branch independent review.
- [ ] Исправить важные findings через RED→GREEN; открыть новый PR, проверить CI и auto-merge=null.
