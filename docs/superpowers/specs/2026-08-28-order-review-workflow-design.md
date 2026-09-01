# Supplier Automation and Order Review Workflow Design

> **Architecture amendment — 2026-09-01:** Упоминания ниже о корневом `ORDERS_AUTO.html` и прежнем packaging acceptance имеют статус **SUPERSEDED**. Актуальный deployment contract определён в `docs/product/SPEC.md` и `docs/architecture/ARCHITECTURE.md`; функциональные требования order-review остаются действующими.

## Status

Approved for implementation on 2026-08-28.

## Goal

Add an operational purchasing workflow on top of the existing MIN/MAX, supplier-resolution, pricing, threshold and export model without changing those calculations. The workflow must let a purchasing manager resolve ambiguous suppliers in bulk, review all orders for one supplier in a SKU × branch matrix, edit quantities from either order view, mark branch orders as checked, and export either all eligible orders or only checked eligible orders.

## Non-goals

This change must not alter:

- deficit calculation (`MAX - stock`);
- MIN/MAX stock statuses;
- join key (`1C code`);
- weighted historical supplier price calculation;
- MIN/MAX price fallback;
- order identity (`branch × supplier`);
- threshold rules or hard blockers;
- supported input file formats;
- local/offline architecture;
- the single root launcher `ORDERS_AUTO.html` and `file://` runtime contract.

## 1. Supplier decisions

### 1.1 Collapsible panel

The full `Требуют решения` area on the Suppliers page becomes collapsible. The collapsed header remains visible and shows at least the unresolved position count. Collapsing must not lose checkbox selection or supplier decisions already made.

### 1.2 Row selection

Every unresolved row gets a checkbox. A header checkbox selects or clears all currently displayed unresolved rows. Checkbox state is UI selection only and must not change supplier resolution by itself.

### 1.3 Bulk supplier automation

The first supported strategy is `MIN_PRICE` (`Минимальная цена`). The design must leave room for additional strategies later without restructuring the page.

For each SKU:

1. consider only historical candidates for the same 1C code;
2. ignore candidates whose weighted historical unit price is missing, non-finite, zero or negative;
3. choose the lowest weighted historical unit price;
4. if the lowest price is tied, choose the candidate with greater historical purchase quantity;
5. if still tied, choose greater historical purchase amount;
6. if still tied, use supplier name as a deterministic final tie-breaker;
7. if no valid candidate remains, leave the SKU unresolved.

Bulk operation scopes:

- `ALL`: all unresolved rows in the decision panel;
- `SELECTED`: only checked rows;
- `EXCEPT_SELECTED`: all unresolved rows except checked rows.

Before execution the UI shows how many rows can actually be auto-resolved under the current strategy and scope.

### 1.4 Manual-selection protection

Supplier overrides gain a source marker: `MANUAL` or `AUTO`. Legacy persisted overrides without a source are treated as `MANUAL`.

A manual selection is never silently overwritten by bulk automation. The UI may expose an explicit `Перезаписать ручные назначения` opt-in, but automatic operations must default to preserving manual decisions. Stale manual overrides that no longer point to a current candidate may be replaced because they are not active valid selections.

Manual selection in a row always writes `source: MANUAL`. Bulk selection writes `source: AUTO`.

## 2. Order review state

### 2.1 Checked status

Each order (`branch × supplier`) has a session-level checked state independent from `READY / BLOCKED / EXPORTED`.

State is represented by order IDs and is not persisted across report sessions. Loading either a new MIN/MAX file or a new supplier file clears all checked statuses. The standard `Загрузить новые отчёты` reset also clears them.

### 2.2 Manual-edit state

An order is manually changed when at least one current line has `orderQty !== calculatedQty`. The UI shows a small hand indicator and the number of changed lines (`✋ N`).

If a user edits a quantity back to its calculated value, that line no longer counts as manually changed. The stored edit entry should be removed when possible so the state reflects only effective differences.

### 2.3 Review invalidation

Changing any quantity in an order automatically clears that order's checked status and exported marker. This applies equally when the edit is made in the normal order drawer or in the supplier matrix.

A checked order may still have historical/manual edits if it was checked after those edits; in that case both `✓` and `✋ N` are shown.

### 2.4 Blocker precedence

Hard blockers always have the strongest visual state. A checked hard-blocked order must not look green/ready, and checked status never bypasses threshold or hard-blocker export rules.

## 3. Orders page: supplier-level workflow

### 3.1 Supplier summary

Each supplier row/card shows:

- supplier name;
- total quantity;
- total amount across all branch orders;
- number of branch orders;
- checked progress, e.g. `6 из 9 проверено`;
- manual-edit indicators when applicable.

The supplier total amount is clickable and opens the supplier-wide matrix.

### 3.2 Supplier matrix

The supplier-wide view is a wide drawer/modal preserving the Orders page context.

Rows are unique SKU codes for that supplier. Columns are branch orders. Fixed identity columns appear on the left; totals appear on the right.

Required columns:

- `Код`;
- `Артикул`;
- `Номенклатура`;
- `Цена`;
- one column per branch that has an order for this supplier;
- `Всего, шт.`;
- `Всего, ₽`.

Each branch header shows:

- branch name;
- branch-order total amount;
- checked state control;
- manual-edit indicator/count.

The matrix must immediately make common SKU quantities across branches visible.

### 3.3 Editing in the matrix

Each `SKU × branch` cell with an order line exposes editable quantity. Empty combinations display `—`.

Editing a cell updates the same underlying edit state used by the normal order drawer. There must not be two independent copies of order quantity.

After an edit, the UI must recalculate immediately:

1. SKU total quantity;
2. SKU total amount;
3. branch-order total amount;
4. supplier total amount;
5. normal order-card values.

### 3.4 Large matrix behavior

- sticky matrix header;
- sticky left identity columns;
- horizontal scrolling for branch columns;
- numeric alignment to the right;
- zero/empty combinations rendered quietly as `—` where appropriate;
- editing must not reset scroll position;
- retain virtualization/performance safeguards where needed.

## 4. Order cards and visual statuses

Normal order cells/cards remain the entry point to the existing order drawer.

Visual priority:

1. hard blocker: red/error treatment;
2. checked: bright but restrained green border plus check icon;
3. manual edits: small hand icon/count;
4. normal unreviewed: neutral border.

A checked edited order shows both `✓` and `✋ N`. If a checked order is subsequently edited, the check is removed automatically.

## 5. Review controls

Checked state can be changed from:

- the normal order drawer;
- the branch header in the supplier matrix;
- supplier-wide actions `Отметить все проверенными` and `Снять проверку со всех`.

The supplier summary displays checked progress. When all supplier orders are checked it may show an aggregate green check.

## 6. Exports

### 6.1 Global ZIP/CSV

Orders page exposes two aggregate actions:

- `Скачать все` — all currently exportable orders under existing blocker/threshold rules;
- `Скачать проверенные` — only orders that are both checked and currently exportable under the same existing rules.

Checked state does not make an otherwise blocked order exportable.

### 6.2 Supplier XLSX

Supplier-level Excel supports:

- all exportable orders for the supplier;
- only checked exportable orders for the supplier.

When only checked orders are exported, the workbook must contain only those branch sheets, and `Общий заказ` must aggregate only those selected branch orders. UI copy shows the count, e.g. `Проверенные · 6 из 9`.

### 6.3 Single-order CSV

Existing single-order CSV behavior remains. Exporting does not automatically mark an order checked.

## 7. State and persistence

`AppState` gains `reviewedOrderIds`.

Supplier overrides remain persisted in IndexedDB, extended with optional source metadata for backward compatibility. Checked order status remains session state because report contents themselves are not persisted and a new import explicitly invalidates review.

## 8. Testing requirements

Automated coverage must include at least:

- `MIN_PRICE` candidate selection;
- price tie-breakers;
- `ALL`, `SELECTED`, `EXCEPT_SELECTED` scopes;
- preservation of active manual overrides;
- collapsible decisions panel;
- bulk supplier assignment UI;
- order checked/un-checked state;
- quantity edit clears checked and exported state;
- edit returning to calculated quantity no longer counts as manual;
- supplier matrix layout (`SKU × branches`);
- matrix editing and all three total levels;
- individual and supplier-wide checked toggles;
- new import clears reviewed statuses;
- checked and manual visual indicators;
- hard-blocker visual precedence;
- export-all vs export-checked ZIP;
- supplier XLSX built from checked subset only;
- root `ORDERS_AUTO.html` fresh-build equality;
- Chrome `file://` smoke.

## 9. Acceptance flow

The intended manager workflow is:

1. import both 1C reports;
2. open Suppliers;
3. bulk-assign obvious ambiguous SKUs by minimum historical price;
4. resolve remaining exceptions manually;
5. open Orders;
6. open one supplier's consolidated matrix;
7. review shared SKU quantities across branches;
8. adjust quantities where needed;
9. mark branch orders checked individually or in bulk;
10. export all eligible orders or only checked eligible orders.
