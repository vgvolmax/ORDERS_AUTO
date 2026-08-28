# Supplier Automation and Order Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk supplier auto-selection, checked-order workflow, supplier-wide SKU × branch review matrix, manual-edit status, and checked-only exports without changing existing purchasing calculations.

**Architecture:** Keep the existing calculated domain projection as the single source of truth. Add pure domain helpers for supplier automation and order workflow state transitions, store checked order IDs in `AppState`, keep supplier override source metadata in the existing IndexedDB store, and compose a new supplier matrix drawer from current derived orders. Export filtering stays in UI/domain selection; CSV/XLSX builders continue to receive concrete `Order[]` subsets.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, ExcelJS, JSZip, IndexedDB/idb, Vite single-file build, Playwright Chrome `file://` smoke.

**Spec:** `docs/superpowers/specs/2026-08-28-order-review-workflow-design.md`

## Global Constraints

- Do not change MIN/MAX demand rules, pricing rules, threshold rules, order identity or join keys.
- Manual supplier choices must be protected from silent bulk overwrite.
- Checked state is session-only and resets on either report import.
- Any effective quantity edit invalidates checked/exported state for that order.
- Hard blockers visually outrank checked state and remain non-exportable.
- `ORDERS_AUTO.html` remains the only root HTML launcher and must pass Chrome `file://` smoke.
- Do not merge or enable auto-merge.

---

### Task 1: Supplier automation domain and persistence

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/suppliers.ts`
- Create: `src/domain/supplierAutomation.ts`
- Modify: `src/persistence/supplierOverrides.ts`
- Test: `tests/domain/supplierAutomation.test.ts`
- Modify test: `tests/domain/suppliers.test.ts`

**Interfaces:**
- Produces `SupplierOverrideSource = 'MANUAL' | 'AUTO'` and optional `SupplierOverride.source`.
- Produces `SupplierAutoStrategy = 'MIN_PRICE'`, `SupplierAutoScope = 'ALL' | 'SELECTED' | 'EXCEPT_SELECTED'`.
- Produces `selectSupplierCandidate(resolution, strategy): SupplierHistory | null`.
- Produces `buildAutoSupplierOverrides({ resolutions, currentOverrides, selectedSkuCodes, scope, overwriteManual, now }): SupplierOverride[]`.
- Produces `saveSupplierOverrides(values): Promise<void>` using one IndexedDB transaction.

- [ ] **Step 1: Write failing domain tests** for minimum-price selection, invalid/missing prices, tie-breaks, all three scopes and active manual-override protection.
- [ ] **Step 2: Run supplier automation tests** and confirm RED because automation helpers/types do not exist.
- [ ] **Step 3: Implement source metadata and pure automation helpers.** Legacy overrides without `source` must behave as manual. Only active `MANUAL_SELECTED` overrides are protected by default; stale overrides may be replaced.
- [ ] **Step 4: Update supplier resolution** so persisted `source: AUTO` resolves to `AUTO_SELECTED`, while legacy/no-source override remains `MANUAL_SELECTED`.
- [ ] **Step 5: Add batch persistence** with a single `readwrite` transaction and keep the existing single-save API for row-level manual selection.
- [ ] **Step 6: Run domain supplier tests** and confirm GREEN.
- [ ] **Step 7: Commit** as `feat: add supplier auto-selection domain`.

### Task 2: Checked-order state and edit lifecycle

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/orderWorkflow.ts`
- Modify: `src/app/appStore.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/features/import/ImportPage.tsx`
- Modify: `src/app/selectors.ts`
- Test: `tests/domain/orderWorkflow.test.ts`
- Modify: `tests/ui/renderWithStore.tsx`
- Modify: `tests/ui/importWorkflow.test.tsx`

**Interfaces:**
- `AppState.reviewedOrderIds: string[]`.
- `Order.manualEditCount: number` and `Order.reviewed: boolean` are derived presentation metadata, not persisted business inputs.
- `applyOrderQtyChange({ edits, reviewedOrderIds, exportedOrderIds, order, skuCode, qty })` returns normalized edits and invalidated review/export state.
- `setOrderReviewed(ids, orderId, reviewed)` and `setOrdersReviewed(ids, orderIds, reviewed)` return de-duplicated arrays.

- [ ] **Step 1: Write failing tests** for effective edit tracking, edit-back-to-calculated cleanup, checked invalidation, exported invalidation and bulk review toggling.
- [ ] **Step 2: Write import regression** proving either successful file replacement clears `reviewedOrderIds`.
- [ ] **Step 3: Run focused tests** and confirm RED.
- [ ] **Step 4: Implement workflow helpers and state field.** Initialize/reset `reviewedOrderIds` to `[]`.
- [ ] **Step 5: Enrich derived orders** with `manualEditCount` from current lines and `reviewed` from state IDs without altering READY/BLOCKED calculation.
- [ ] **Step 6: Reset review markers** when either import is accepted; also clear stale exported markers because the calculated order set has changed.
- [ ] **Step 7: Run focused and existing domain/UI tests** and confirm GREEN.
- [ ] **Step 8: Commit** as `feat: add order review lifecycle`.

### Task 3: Suppliers page bulk-decision UX

**Files:**
- Modify: `src/features/suppliers/SuppliersPage.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/ui/suppliersPage.test.tsx`

**Interfaces:**
- Uses Task 1 automation helpers and batch persistence.
- Manual row selection writes `source: 'MANUAL'`.
- Bulk automation writes `source: 'AUTO'` and rolls back optimistic state if persistence fails.

- [ ] **Step 1: Add UI tests** for collapsing/expanding `Требуют решения`, row checkboxes, `SELECTED` and `EXCEPT_SELECTED` scope controls, preview count, and minimum-price bulk application.
- [ ] **Step 2: Run SuppliersPage tests** and confirm RED.
- [ ] **Step 3: Refactor `SupplierDecisions`** into a collapsible panel with preserved local checkbox state and a select-all checkbox.
- [ ] **Step 4: Add automation toolbar** with strategy (`Минимальная цена`), scope, explicit overwrite-manual checkbox, preview text and apply button.
- [ ] **Step 5: Implement optimistic bulk save/rollback** and clear applied checkbox selections after success.
- [ ] **Step 6: Add restrained responsive styling** matching existing B2B UI.
- [ ] **Step 7: Run SuppliersPage and full unit test suite** and confirm GREEN.
- [ ] **Step 8: Commit** as `feat: add bulk supplier decisions`.

### Task 4: Supplier-wide order matrix and checked controls

**Files:**
- Create: `src/features/orders/SupplierOrdersDrawer.tsx`
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify: `src/features/orders/OrderDrawer.tsx`
- Modify: `src/styles/app.css`
- Create test: `tests/ui/supplierOrdersDrawer.test.tsx`
- Modify test: `tests/ui/ordersPage.test.tsx`

**Interfaces:**
- `SupplierOrdersDrawer` receives `supplier`, `orders`, ordered branch names, `onEdit(order, skuCode, qty)`, `onSetReviewed(orderId, reviewed)`, `onSetAllReviewed(orderIds, reviewed)`, `onClose`.
- Uses the same edit transition from Task 2 as the normal order drawer.
- Supplier matrix rows are SKU codes; branch columns are branch orders; right columns are SKU quantity and amount totals.

- [ ] **Step 1: Add failing matrix tests** proving rows are SKU, headers are branches, branch totals are visible, and common SKU totals sum across branches.
- [ ] **Step 2: Add failing interaction tests** for editing a matrix cell, individual review checkbox, mark-all reviewed, uncheck-all, manual hand count, and automatic check invalidation after edit.
- [ ] **Step 3: Run focused UI tests** and confirm RED.
- [ ] **Step 4: Implement `SupplierOrdersDrawer`** with sticky identity columns/header, branch header cards, editable quantity cells, SKU totals and supplier summary.
- [ ] **Step 5: Enhance OrdersPage supplier totals** so clicking total opens the supplier drawer and the supplier row shows checked progress/manual edit count.
- [ ] **Step 6: Enhance normal order cells** with visual check and hand indicators; hard blocker class must take priority over checked class.
- [ ] **Step 7: Add checked control to `OrderDrawer`** and route both views through the same order edit/review state transitions.
- [ ] **Step 8: Run OrdersPage/Drawer tests and full unit suite** and confirm GREEN.
- [ ] **Step 9: Commit** as `feat: add supplier order review matrix`.

### Task 5: All vs checked exports

**Files:**
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify: `src/export/download.ts` only if a generic naming/API cleanup is needed without changing CSV contents.
- Modify: `src/export/supplierWorkbook.ts` only where needed to make subset behavior explicit/testable.
- Modify: `tests/ui/ordersPage.test.tsx`
- Modify: `tests/export/supplierWorkbook.test.ts`

**Interfaces:**
- `exportableOrders` continues to mean orders allowed by current READY/EXPORTED rules.
- `checkedExportableOrders = exportableOrders.filter(order => order.reviewed)`.
- Supplier XLSX builder receives the exact concrete subset to include; it does not independently infer checked state.

- [ ] **Step 1: Add failing OrdersPage tests** for separate `Скачать все` and `Скачать проверенные` ZIP actions and for supplier Excel all/checked actions.
- [ ] **Step 2: Extend workbook test** so a checked-subset call produces only selected branch sheets and aggregates only those branches on `Общий заказ`.
- [ ] **Step 3: Run export/UI tests** and confirm RED.
- [ ] **Step 4: Implement global and supplier export filtering** while preserving existing blocker/threshold rules and existing single-order CSV behavior.
- [ ] **Step 5: Show counts in labels**, e.g. checked count versus supplier total.
- [ ] **Step 6: Run export and full unit suites** and confirm GREEN.
- [ ] **Step 7: Commit** as `feat: export checked orders separately`.

### Task 6: Acceptance coverage, performance and accessibility pass

**Files:**
- Modify: `tests/ui/ordersPage.test.tsx`
- Modify: `tests/ui/suppliersPage.test.tsx`
- Modify: `tests/ui/supplierOrdersDrawer.test.tsx`
- Modify: `src/styles/app.css`
- Modify: `docs/testing/ACCEPTANCE_CRITERIA.md`

**Interfaces:** No new business interfaces; this task locks acceptance behavior and presentation invariants.

- [ ] **Step 1: Add/adjust tests** for hard-blocker visual precedence, aggregate checked progress, checkbox labels, keyboard-accessible buttons, and no loss of local decision selection when collapsed.
- [ ] **Step 2: Review matrix rendering** for avoidable repeated `find/filter` work; pre-index order lines by SKU/branch inside memoized computations rather than scanning the entire order set per cell.
- [ ] **Step 3: Finalize CSS** for checked green border, blocker red priority, hand/check icons, sticky headers/columns and horizontally scrollable branch area.
- [ ] **Step 4: Update acceptance criteria** with the new operational workflow.
- [ ] **Step 5: Run `npm run typecheck` and `npm test -- --run`** and confirm all suites GREEN.
- [ ] **Step 6: Commit** as `test: lock order review workflow acceptance`.

### Task 7: Root launcher, browser smoke and PR completion

**Files:**
- Generated/modify: `ORDERS_AUTO.html`
- Existing verification: `.github/workflows/verify.yml`
- Existing e2e: `tests/e2e/offline.spec.ts`

**Interfaces:** The committed root artifact must equal a fresh build exactly.

- [ ] **Step 1: Run/trigger production build** so `ORDERS_AUTO.html` is regenerated from the final source.
- [ ] **Step 2: Verify committed artifact freshness** (`git diff --exit-code -- ORDERS_AUTO.html` in CI).
- [ ] **Step 3: Run full GitHub Actions gates:** dependency install, typecheck, all Vitest tests, build, root-artifact equality, Chrome `file://` smoke, production audit and artifact upload.
- [ ] **Step 4: Inspect final PR diff** for accidental calculation-model changes, temporary workflows, private report data, generated diagnostics, or unrelated refactors.
- [ ] **Step 5: Update PR body** with implemented behavior and exact final run/test counts.
- [ ] **Step 6: Mark PR Ready only after the final HEAD is fully green. Do not merge and do not enable auto-merge.**
