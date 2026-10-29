# Маршруты и полное распределение артикула — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить ручные приоритеты автоматическим полным покрытием SKU и компактной настройкой маршрутов.
**Architecture:** Сохраняем чистый сетевой flow и accepted-only закупку. Результат расчёта содержит структурированные пропуски; физический снимок сохраняет выключенные подразделения. UI настраивает пары атомарно через прежнюю CAS-очередь.
**Tech Stack:** React19, strict TypeScript, Vite, Vitest/RTL, Playwright Chrome file://, IndexedDB.
**Spec:** docs/superpowers/specs/2026-10-29-routes-full-coverage-design.md (согласована пользователем29.10.2026)

## Global Constraints

- Offline/file://, Код1С как ключ, сохранение сеанса, donor >= Max и закупка только по принятым движениям сохраняются.
- Работу не мержить и не включать auto-merge.
- Для текущих9 подразделений вся матрица, заголовки, легенда и управление помещаются на1280×720 и1280×600 без прокрутки страницы или матрицы.
- Новый proposal не содержит allocation-полей; старые принятые движения сохраняются.
- Шаг и верхняя граница цели обязательны; пропуск SKU при невозможности точного полного покрытия.

## Review Focus

- Legacy partial proposal с совпавшими snapshot/config: домен запрещает новые принятия, уже принятые и revoke работают.
- Выключение стороны accepted ledger не удаляет физическую строку, не меняет закупку и не ломает отмену.
- Общий запас достаточен, но cut маршрутов не позволяет закрыть получателя: пропускается весь SKU.
- Невалидная известная выбранная потребность не исчезает через адаптер, создавая ложное полное покрытие.
- Быстрые записи маршрутов/активности и запуск расчёта: используются committed последние входы; ошибки не принимают старый план.

## Shared interfaces / ownership

- Domain result: optional `skippedSkus: SkippedRebalanceSku[]`, optional `participationFingerprint: string`; legacy absence means outdated algorithm, not zero skipped.
- `SkippedRebalanceSku`: skuCode, neededQty, deliverableQty, missingQty, reason (`INSUFFICIENT_SURPLUS` | `ROUTE_LIMIT` | `QUANTITY_STEP`), recipients [{branchId,neededQty,deliverableQty}]. Unit/name/referencePrice join from snapshot by skuCode.
- Domain exports current `ALGORITHM_VERSION` and `branchParticipationFingerprint(branches: BranchRegistry): string`.
- RoutesMatrix props preserve registry/value/onChange; add `onRegistryChange(registry: BranchRegistry): void`. Pure pair editing lives in new `routeEditing.ts`; route-only styles in `RoutesMatrix.css`.
- Root owns RebalancingPage/ResultsTable, load normalization, export/KPI/list, UI integration tests and documentation. Domain and route editing tasks may run concurrently on disjoint owned files.

### Task 1: Сетевое полное покрытие и доменные границы

**Files:** calculate.ts, types.ts, constraints.ts, validation.ts, acceptedTransfers.ts, index.ts, import/rebalanceSnapshot.ts; remove allocationPlan/allocationSplit/donorPriorityLevels runtime; tests/domain and affected domain fixtures.
**Consumes:** существующие allocateFlow/quantity helpers и approved spec.
**Produces:** shared result and signature interfaces above; pure all-or-nothing plan, stable accepted validation.

- [ ] Write tests/fullSkuCoverage.test.ts: need8+6/surplus12 -> transfers[], needed14/deliverable12/missing2; multi-donor8+6 ->14; route bottleneck20/4 ->0; disconnected graph one shortage ->0; all inbound blocked excludes receiver; fractional0.3/step0.2 ->0; invalid selected row ->0; accepted5 leaves9; permutations stable.
- [ ] Run focused tests and observe RED assertions against legacy partial behavior.
- [ ] Implement exact full coverage gate and structured diagnostic result; capture active signature and bump algorithm. Preserve inactive physical rows and enforce participation for new additions; version/signature guards do not block historical revoke/no-op.
- [ ] Add accept/revoke tests for old algorithm and inactive accepted side, watch RED then GREEN. Remove obsolete manual allocation tests; revise old partial fixtures only where current rule explicitly changes expectation, retaining physical, precision, flow and acceptance regressions with fully feasible data.
- [ ] Run domain suite, typecheck; root later runs full integrated suite/build. Commit coherent domain change.

### Task 2: Компактная матрица и массовые направления

**Files:** RoutesMatrix.tsx, RoutesMatrix.css, new domain/rebalancing/routeEditing.ts, tests/ui/routesMatrix.test.tsx, tests/domain/routeEditing.test.ts.
**Consumes:** existing RouteConfig/BranchRegistry; shared callback above.
**Produces:** full9×9 readable matrix, pair/group editor and participation control with persisted callbacks.

- [ ] Write failing pure tests: reversed pair orientation; row/column group sender/receiver semantics, inactive untouched, no diagonal/duplicates, no mutation.
- [ ] Implement pure setRouteDirection and setBranchRoutes helpers with explicit typed inputs.
- [ ] Write failing RTL workflow: four labeled choices, atomic apply/cancel, mirrored arrow, active checkbox both axes, disabled connections, row and column group scope independent of page.
- [ ] Implement compact semantic matrix using common Dialog/Button; red×/green↔/blue→←/muted disabled, textual legend and accessible full pair names, viewport-aware axis pages beyond9 without dropping branches. Modal radio choices, focus/escape/restore via shared Dialog.
- [ ] Run focused domain+UI tests; root adds native geometry assertions. Commit route-only change.

### Task 3: Сохранения и удаление ручного workflow

**Files:** initialState.ts/workspace.ts, rebalanceActions.ts, RebalancingPage.tsx, ResultsTable.tsx; delete donor UI/summary and associated obsolete UI tests; add tests/ui/fullCoverageWorkflow.test.tsx and persistence regressions.
**Consumes:** Task1 algorithm/signature guards; Task2 registry callback.
**Produces:** three tabs, stale legacy plans, queued config/registry changes, independent selected acceptance.

- [ ] Add RED tests for legacy `tab:priorities` -> routes while preserving ledger/proposal; current plan with activity change -> stale; accepted side deactivated -> unchanged purchase and revoke possible.
- [ ] Remove donor edit commands, drawers/links/blockedSources priority computation and dead UI/styles; retain legacy DTO fields for reading history. New calculation version is mandatory before further accepting a legacy proposal.
- [ ] Wire registry callback into existing durable queue; protect workspace/run identity and wait before calculate/accept. Add failure/reload race tests.
- [ ] Run focused workflow/persistence suite and typecheck; commit integration.

### Task 4: Пропуски, KPI и XLSX

**Files:** new skippedRebalance.ts projection, SkippedRebalanceList.tsx, RebalancingPage.tsx, rebalancingWorkbook.ts, tests/domain/fullCoverageSummary.test.ts, tests/export/rebalancingWorkbook.test.ts, tests/ui/fullCoverageWorkflow.test.tsx.
**Consumes:** Task1 skipped records and existing transferDocuments.
**Produces:** pending amount/quantity and skipped full need, structured list/receiver details and XLSX sheet.

- [ ] Add RED tests: skipped14 rather than shortfall2; unknown money stays unknown; mixed units separate; pending excludes accepted-source/rejected and is independent of query.
- [ ] Implement one pure summary projection and list using SearchInput/VirtualTable, receiver detail Dialog; no-results/no-plan/no-skips/stale states; dashboard link opens list without adding priority tab.
- [ ] Add RED workbook test reading generated XLSX: skipped SKU/recipient needs/deliverable/missing/reason/full-need amount; unknown price blank; no active manual-priority parameters. Implement export and keep CSV accepted-only.
- [ ] Run focused UI/projection/export tests and typecheck; commit.

### Task 5: Контракты, браузер и whole-branch review

**Files:** DESIGN/UX-CONTRACT, product/data/derived/architecture/UX/testing docs, tests/e2e/offline.spec.ts, ci unchanged unless required by actual failure.
**Consumes:** integrated Tasks1–4.
**Produces:** new PR, green unit/typecheck/build/native evidence, reviewed branch, no merge.

- [ ] Update contracts with29.10 precedence; mark superseded priority specs/plans rather than silently keeping contradictory current rules. Remove dead manual E2E scenarios and replace with current automatic full-coverage flow.
- [ ] Chrome file:// import9branches -> configure group/pair/disable -> calculate full and skipped SKU -> no partial lines -> inspect skip metrics -> select/accept -> order/popover/CSV -> reload -> deactivate accepted side -> revoke. Geometry1280×720/1280×600,1024fallback, overflow assertion on actual route frame and page, open edit dialogs, extended registry/long names/zoom.
- [ ] Run typecheck, all Vitest, build/package and native E2E (CI fallback if host Chrome unavailable), premium static audit. Keep actual command output.
- [ ] Request one fresh whole-branch code review, fix important findings with regression RED→GREEN and full suite, then publish branch/PR. Verify exact-head CI and PR open/auto-merge off. No merge.
