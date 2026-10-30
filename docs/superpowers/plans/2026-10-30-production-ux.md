# Production UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить необходимые проблемы UX-аудита, выровнять существующие экраны и предоставить скриншоты без merge.
**Architecture:** Общие владельцы App navigation, VirtualTable, Dialog и runtime CSS; предметные проекции остаются readonly. Все записи проходят существующий workspaceSession.
**Tech Stack:** React19, TypeScript strict, Vite, TanStack Virtual, Vitest/RTL, Playwright; локальные WOFF2.
**Spec:** docs/superpowers/specs/2026-10-30-production-ux-design.md

## Global Constraints

- Runtime file:// без HTTP, backend, CDN и новых runtime dependencies.
- Не менять расчёт full coverage/accepted/purchase и persistence schema.
- Девять подразделений без прокрутки при1280×720/600; расширенный реестр — существующие страницы.
- Код → Артикул → Наименование, ведущие нули, readonly transfers и accepted-only CSV сохраняются.
- Не мержить и не включать auto-merge; скриншоты только синтетических данных.

## Review Focus

- Новый короткий раздел после прокрученного длинного и возвращение из nested modal сохраняют правильный контекст.
- Неизвестная цена и несколько доноров/получателей не превращаются в ложную нулевую сумму подтверждения.
- Сортировка/скрытие столбцов не меняют selected IDs и область принятия/экспорта.
- Длинные коды/названия, fallback fonts и stale warning не перекрывают frozen surfaces или9×9 routes.
- Пустой результат,100+ строк и ошибка сохранения сохраняют навигацию, keyboard и доступность действий.

### Task 1: Навигация и подтверждения
**Files:** src/app/usePageScroll.ts; App.tsx; components/Dialog.tsx; features/rebalancing/AcceptTransfersDialog.tsx, RebalancingPage.tsx; tests/ui/pageScroll.test.tsx,acceptTransfers.test.tsx.
**Interfaces:** usePageScroll(page,workspaceId,enabled); Dialog size default|wide; AcceptanceScopeSummary сохраняет donor/recipients/skuCount/amount/missingPriceLineCount.
- [ ] Написать/увидеть RED на независимой scroll restoration и summary выбора из живой RebalancingPage, включая неизвестную цену.
- [ ] Реализовать shared hook и wide dialog, передавать summary выбранных committed rows, показать изменение суммы закупки.
- [ ] Проверить targeted tests и typecheck; commit.

### Task 2: Общие таблицы
**Files:** components/VirtualTable.tsx, productColumns.tsx; app/tablePreferences.ts; features/demand/DemandPage.tsx; tests/ui/virtualTable.test.tsx,productColumns.test.tsx.
**Interfaces:** VirtualColumn sticky?:boolean, sortValue?:(row)=>string|number|null; TableSort={key,direction}; optional controlled sort/hiddenColumns callbacks; persistent preferences через существующий usePreference на Demand.
- [ ] RED на семантике/метаданных, сортировке null-last, frozen offsets и неизменном выборе строк при смене колонок.
- [ ] Общий primitive: accessible table внутри scroll surface, sticky identity, sort buttons и column options; подключить Demand.
- [ ] Targeted tests/typecheck; commit.

### Task 3: Типографика, плотность и маршруты
**Files:** styles/app.css, styles/fonts/*; RoutesMatrix.css/tsx; DESIGN.md, UX-CONTRACT.md; tests/e2e/offline.spec.ts.
**Interfaces:** локальная Inter normal100..900 с кириллицей; CSS tokens font/body/data/help/title, page padding24/sidebar224; routes checkbox label24×24.
- [ ] Сохранить RED E2E10 на1280×600 и добавить геометрию target24px/видимых9строк с предупреждением. Существующие assertions не ослаблять.
- [ ] Внести shared tokens, локальные font assets/license, header/sidebar rhythm, opaque frozen cells, wide modal и компактные маршруты.
- [ ] Проверить весь unit suite/typecheck/build/E2E; inspect реальные снимки; commit.

### Task 4: Операционные экраны и feedback
**Files:** ResultsTable.tsx,TransferDrawer.tsx,SkippedRebalanceList.tsx,ConditionsPanel.tsx,RebalancingPage.tsx; OrdersPage.tsx,SuppliersPage.tsx,ImportPage.tsx; tests/ui/transferInspector.test.tsx,suppliersPage.test.tsx,fullCoverageWorkflow.test.tsx.
**Interfaces:** SkippedRebalanceList.onRoutes?; прежние IDs/callbacks/CAS неизменны. Readonly summary не становится источником доменных сумм.
- [ ] RED на видимом скрытом выборе и переходе из пропуска к маршрутам; изменить obsolete one-option strategy assertions по новому UX.
- [ ] Уплотнить карточки/шапки/строки от88px, подписать область KPI, перенести инструкции в disclosure, убрать шум toast при autosave, добавить import/target/skip guidance.
- [ ] Targeted tests/typecheck/build и sibling browser comparison; commit.

### Task 5: Проверки, review и выдача
**Files:** tests/e2e/offline.spec.ts; docs/ux/UX_AND_EXPORT.md; premium-ui.json при необходимости evidence paths.
**Interfaces:** текущие test:e2e и автономный production artifact; screenshot deliverables вне репозитория.
- [ ] Typecheck, все unit, build, весь E2E; strict premium audit, DESIGN lint и axe по изменённым flow.
- [ ] Независимое whole-branch review, один проход исправлений важных находок с RED→GREEN.
- [ ] Снимки Import/Demand/Routes/Results/Transfer/Confirmation/Suppliers/Orders/History, визуальная проверка1280/1440 и short viewport; сохранить и предоставить пользователю.
- [ ] Опубликовать отдельный PR от main, проверить head/CI, оставить без merge/auto-merge.
