# ORDERS_AUTO Implementation Plan

> **SUPERSEDED for production packaging by the 2026-09-01 deployment contract.** Все шаги и Definition of Done ниже, требующие single-file, `vite-plugin-singlefile`, единственный `dist/index.html`, inline bundle или `assert-single-file`, сохранены как историческая последовательность и больше не являются действующими требованиями. Актуальный контракт: `docs/product/SPEC.md` и `docs/architecture/ARCHITECTURE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a serverless Russian-language HTML application that converts Min-Max and supplier 1C reports into validated purchase orders grouped by branch and supplier, with CSV/XLSX export.

**Architecture:** Modular React/TypeScript source with pure domain functions and parser/export adapters. Runtime is fully client-side; persisted user decisions live in IndexedDB. Vite produces one self-contained HTML artifact via `vite-plugin-singlefile`.

**Tech Stack:** React, TypeScript strict, Vite, `vite-plugin-singlefile`, `xlsx`, `exceljs`, `jszip`, `idb`, `@tanstack/react-table`, `@tanstack/react-virtual`, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-28-orders-auto-design.md`

## Global Constraints

- No backend, local server, SQLite, telemetry, CDN, or runtime network API.
- Production output is one `dist/index.html` that works via `file://` in current Chrome/Edge.
- Join reports only by 1C code.
- Real company reports are never committed.
- TypeScript `strict: true`; business rules are pure functions outside React.
- Russian UI; desktop-first from 1280 px.
- Follow exact rules in `docs/product/SPEC.md`, `docs/data/DATA_CONTRACTS.md`, `docs/data/DERIVED_PROJECTIONS.md`, `docs/ux/UX_AND_EXPORT.md`.

---

### Task 1: Scaffold, test harness and single-file build

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/styles/app.css`
- Create: `scripts/assert-single-file.mjs`
- Create: `tests/setup.ts`
- Create: `tests/ui/appSmoke.test.tsx`

**Interfaces:**
- Produces npm scripts `dev`, `typecheck`, `test`, `build`, `verify`.

- [ ] **Step 1: Create package.json with exact dependency families**

Runtime dependencies: `react`, `react-dom`, `xlsx`, `exceljs`, `jszip`, `idb`, `@tanstack/react-table`, `@tanstack/react-virtual`.

Dev dependencies: `vite`, `@vitejs/plugin-react`, `vite-plugin-singlefile`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `fake-indexeddb`.

Scripts:

```json
{
  "dev": "vite",
  "typecheck": "tsc --noEmit",
  "test": "vitest",
  "build": "vite build && node scripts/assert-single-file.mjs",
  "verify": "npm run typecheck && npm test -- --run && npm run build"
}
```

- [ ] **Step 2: Configure strict TypeScript**

At minimum enable:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "jsx": "react-jsx"
}
```

- [ ] **Step 3: Configure Vite/Vitest and single-file output**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  build: { sourcemap: false },
  plugins: [react(), viteSingleFile()],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] }
});
```

- [ ] **Step 4: Add deterministic artifact assertion**

```js
import fs from 'node:fs';
const files = fs.readdirSync('dist');
if (files.length !== 1 || files[0] !== 'index.html') {
  throw new Error(`Expected only dist/index.html, got: ${files.join(', ')}`);
}
const html = fs.readFileSync('dist/index.html', 'utf8');
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet/i.test(html)) {
  throw new Error('Build is not self-contained');
}
```

- [ ] **Step 5: Write failing smoke test, implement minimal App, run verify**

```tsx
render(<App />);
expect(screen.getByRole('heading', { name: /формирование заказов/i })).toBeInTheDocument();
```

Run `npm run verify`. Commit: `chore: scaffold client-only single-file app`.

---

### Task 2: Domain contracts and value normalization

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/normalize.ts`
- Test: `tests/domain/normalize.test.ts`

**Interfaces:**
- Types match `DATA_CONTRACTS.md` and `DERIVED_PROJECTIONS.md` exactly.
- `normalizeText(value: unknown): string`
- `normalizeKey(value: unknown): string`
- `parseOptionalNumber(value: unknown): number | null`
- `parseStockNumber(value: unknown): number`

- [ ] **Step 1: Write failing normalization tests**

```ts
expect(normalizeText('  Наро\u00A0Фоминск  ')).toBe('Наро Фоминск');
expect(normalizeKey('  Контрагент ')).toBe('контрагент');
expect(parseOptionalNumber('1 234,50')).toBe(1234.5);
expect(parseOptionalNumber(' ')).toBeNull();
expect(parseStockNumber(' ')).toBe(0);
```

- [ ] **Step 2: Implement exact normalizers**

```ts
export function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
}
export function normalizeKey(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase('ru-RU');
}
export function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
export function parseStockNumber(value: unknown): number {
  return parseOptionalNumber(value) ?? 0;
}
```

- [ ] **Step 3: Define domain types, run focused tests + typecheck**

Commit: `feat: add normalized domain contracts`.

---

### Task 3: Min-Max workbook parser

**Files:**
- Create: `src/import/workbook.ts`
- Create: `src/import/minMaxParser.ts`
- Create: `tests/fixtures/workbookBuilders.ts`
- Test: `tests/import/minMaxParser.test.ts`

**Interfaces:**
- `readFirstSheetRows(input: ArrayBuffer): unknown[][]`
- `parseMinMaxWorkbook(input: ArrayBuffer): ParseResult<MinMaxDataset>`

- [ ] **Step 1: Generate synthetic `.xlsx` in memory**

```ts
export function buildWorkbook(rows: unknown[][], bookType: 'xls' | 'xlsx'): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TDSheet');
  return XLSX.write(wb, { type: 'array', bookType });
}
```

- [ ] **Step 2: Write parser tests before implementation**

Fixture must contain a coded group row with no branch children, followed by a real SKU with branch rows. Assert group row is ignored, blank branch stock becomes 0, new branch is discovered, duplicate `sku+branch` creates issue, null MAX stays null, parent-total mismatch only warns.

- [ ] **Step 3: Implement generic workbook reader**

```ts
export function readFirstSheetRows(input: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(input, { type: 'array', cellDates: false });
  const name = wb.SheetNames[0];
  if (!name) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: true, defval: null });
}
```

- [ ] **Step 4: Implement header mapping deterministically**

Find the first row containing normalized headers `код`, `артикул`, `номенклатура`, a header containing `количество`, `минимальный остаток`, `максимальный остаток`, `цена`. Build indexes once. If required columns except article/price are absent, return fatal `MISSING_REQUIRED_COLUMN`.

- [ ] **Step 5: Implement block scan exactly**

Use one forward scan:

```ts
for (let i = headerRow + 1; i < rows.length; ) {
  const row = rows[i]!;
  const code = normalizeText(row[col.code]);
  if (!code) { i += 1; continue; }

  let j = i + 1;
  const children: unknown[][] = [];
  while (j < rows.length && !normalizeText(rows[j]![col.code])) {
    children.push(rows[j]!);
    j += 1;
  }

  const branchRows = children.filter(r =>
    !normalizeText(r[col.code]) &&
    !normalizeText(r[col.article]) &&
    normalizeText(r[col.name]) !== '' &&
    [r[col.stock], r[col.min], r[col.max]].some(v => parseOptionalNumber(v) !== null || normalizeText(v) === '')
  );

  if (branchRows.length > 0) {
    // create exactly one Sku from row and BranchStock records from branchRows
  }
  i = j;
}
```

When creating records: preserve code as string; stock blank→0; MIN/MAX blank→null; check duplicate pair before push; `MIN>MAX` emits `INVALID_NORM`; parent total mismatch >0.01 emits `TOTAL_STOCK_MISMATCH`; branch rows remain source of truth.

- [ ] **Step 6: Run parser suite + verify**

Commit: `feat: parse hierarchical min-max reports`.

---

### Task 4: Supplier `.xls/.xlsx` parser

**Files:**
- Create: `src/import/supplierParser.ts`
- Modify: `tests/fixtures/workbookBuilders.ts`
- Test: `tests/import/supplierParser.test.ts`

**Interfaces:**
- `parseSupplierWorkbook(input: ArrayBuffer): ParseResult<SupplierDataset>`

- [ ] **Step 1: Write flat and grouped layout tests for both book types**

Flat rows repeat supplier. Grouped rows set supplier once, then item rows omit supplier. Include duplicate supplier+SKU and `Итого` row. Assert aggregation and weighted unit price.

- [ ] **Step 2: Resolve header aliases once**

Use normalized aliases from `DATA_CONTRACTS.md`. Header search scans rows from top and chooses the first row matching skuCode plus quantity/amount and supplier/name structure. Item rows are not read before a header is resolved.

- [ ] **Step 3: Implement grouped state**

```ts
let currentSupplier: string | null = null;
for (const row of dataRows) {
  const supplierCell = normalizeText(row[col.supplier]);
  const skuCode = normalizeText(row[col.skuCode]);
  const rowName = normalizeKey(row[col.skuName] ?? supplierCell);

  if (['итого', 'всего'].includes(rowName)) continue;
  if (supplierCell && !skuCode) { currentSupplier = supplierCell; continue; }

  const supplier = supplierCell || currentSupplier;
  if (!supplier || !skuCode) continue;
  // parse quantity/amount/unit and append raw history row
}
```

- [ ] **Step 4: Aggregate by `supplier + NUL + skuCode`**

Sum quantity and amount. `weightedUnitCost = purchaseQty > 0 && purchaseAmount >= 0 ? purchaseAmount / purchaseQty : null`. Keep unit from the first non-empty item; if later non-empty unit differs, add validation warning.

- [ ] **Step 5: Verify generated BIFF8 `.xls` and `.xlsx` fixtures**

Commit: `feat: parse supplier history from xls and xlsx`.

---

### Task 5: Demand engine and money projection

**Files:**
- Create: `src/domain/demand.ts`
- Test: `tests/domain/demand.test.ts`

**Interfaces:**
- `calculateStockStatus(stock, min, max)`
- `calculateDemand(dataset): DemandLine[]`
- `priceDemand(demand, skus, resolutions): PricedDemandLine[]`

- [ ] **Step 1: Encode every status boundary from acceptance criteria**

```ts
expect(calculateStockStatus(40,20,40).status).toBe('OK');
expect(calculateStockStatus(30,20,40).status).toBe('YELLOW');
expect(calculateStockStatus(29,20,40).status).toBe('ORANGE');
expect(calculateStockStatus(19,20,40).status).toBe('BELOW_MIN');
expect(calculateStockStatus(5,null,40).status).toBe('LIGHT_RED');
expect(calculateStockStatus(5,50,40).status).toBe('INVALID_NORM');
```

- [ ] **Step 2: Implement ordered rules exactly**

```ts
if (max == null || max <= 0) return NO_NORM;
if (min != null && min > max) return INVALID_NORM;
const deficitQty = Math.max(0, max - stock);
if (stock >= max) return OK;
const deficitPct = deficitQty / max;
if (min != null && stock < min) return BELOW_MIN;
if (deficitPct <= 0.25) return YELLOW;
if (deficitPct <= 0.75) return ORANGE;
return LIGHT_RED;
```

- [ ] **Step 3: Calculate network deficit in O(n)**

First Map `skuCode→ΣdeficitQty`, then create demand lines. Do not perform nested full-array searches.

- [ ] **Step 4: Price demand using the exact fallback**

For a resolved selected supplier use that supplier's weighted unit cost. Otherwise use Min-Max reference price. If neither exists, amount is null. Compute local `demandAmount`; then second O(n) pass computes `networkDemandAmount` as the sum of known local amounts and `networkMissingPriceCount`.

- [ ] **Step 5: Run tests and commit**

Commit: `feat: calculate branch and network replenishment demand`.

---

### Task 6: Supplier resolution and IndexedDB persistence

**Files:**
- Create: `src/domain/suppliers.ts`
- Create: `src/persistence/db.ts`
- Create: `src/persistence/supplierOverrides.ts`
- Create: `src/persistence/settings.ts`
- Test: `tests/domain/suppliers.test.ts`
- Test: `tests/persistence/persistence.test.ts`

**Interfaces:**
- `resolveSuppliers(history, overrides): SupplierResolution[]`
- `getSupplierOverrides()` / `saveSupplierOverride()`
- `getSettings()` / `saveSettings()`

- [ ] **Step 1: Write resolution tests**

0 candidate→UNRESOLVED; 1→AUTO_SINGLE; 2+→MANUAL_REQUIRED with `selectedSupplier=null`; recommendation sorts purchaseQty desc, purchaseAmount desc, supplier localeCompare; valid override→MANUAL_SELECTED; missing override candidate→STALE_OVERRIDE.

- [ ] **Step 2: Implement resolution; never auto-select 2+ candidates**

Candidates are grouped by skuCode. Manual override has priority only when supplier exists in current candidates.

- [ ] **Step 3: Implement IndexedDB schema**

```ts
openDB('orders-auto', 1, {
  upgrade(db) {
    db.createObjectStore('supplierOverrides', { keyPath: 'skuCode' });
    db.createObjectStore('settings');
  }
});
```

Store only overrides and settings, never raw workbooks. Use `fake-indexeddb/auto` in persistence tests.

- [ ] **Step 4: Run tests and commit**

Commit: `feat: resolve and persist supplier choices`.

---

### Task 7: Order engine and threshold modes

**Files:**
- Create: `src/domain/orders.ts`
- Test: `tests/domain/orders.test.ts`

**Interfaces:**
- `buildOrderProjection(pricedDemand, resolutions, edits, settings): OrderProjection`
- `OrderProjection = { orders: Order[]; unassigned: UnassignedDemand[] }`

- [ ] **Step 1: Test unresolved demand is retained**

A deficit SKU with UNRESOLVED/MANUAL_REQUIRED/STALE_OVERRIDE must appear in `unassigned`; it must not silently disappear and must not create a supplier order.

- [ ] **Step 2: Build one order per `branch × selectedSupplier`**

Only valid demand with `deficitQty>0` can create lines. Default `orderQty=deficitQty`; apply matching session edit by skuCode+branch. Negative edits are rejected by the store before projection.

- [ ] **Step 3: Calculate order amount and blockers**

`line.amount = unitPrice == null ? null : orderQty*unitPrice`. If any positive-qty line has null price, order total is null and order is BLOCKED. `orderQty>calculatedQty` adds warning but does not block by itself.

- [ ] **Step 4: Implement both threshold modes with tests**

`SUPPLIER_TOTAL`: aggregate all order totals per supplier first; every order for supplier is belowThreshold only when the supplier aggregate is below the configured minimum. `BRANCH_SUPPLIER`: compare each order total independently. Below-threshold orders remain in projection and are BLOCKED for normal export.

- [ ] **Step 5: Run tests and commit**

Commit: `feat: build editable orders and threshold rules`.

---

### Task 8: App state and import screen

**Files:**
- Create: `src/app/appStore.ts`
- Create: `src/app/selectors.ts`
- Create: `src/features/import/ImportPage.tsx`
- Create: `src/components/KpiCard.tsx`
- Modify: `src/app/App.tsx`
- Test: `tests/ui/importWorkflow.test.tsx`

**Interfaces:**
- Actions: `loadMinMaxFile`, `loadSupplierFile`, `commitImports`, `setSupplierOverride`, `setOrderQty`, `setSettings`.
- Selectors own all derived projections; React components do not reimplement formulas.

- [ ] **Step 1: Write integration test using synthetic File objects**

Upload both generated workbooks, assert detected branches/supplier count and enabled `Перейти к потребности`.

- [ ] **Step 2: Implement import state**

`File.arrayBuffer()`→parser. Show file name, counts, fatal errors and row warnings. Both datasets must be nonfatal before continue.

- [ ] **Step 3: Load persisted settings/overrides on startup**

Use a compact loading state until IndexedDB initialization completes; failure to open IndexedDB shows warning and keeps app usable with in-memory defaults.

- [ ] **Step 4: Build dynamic navigation from discovered branches**

Commit: `feat: add report import and application state`.

---

### Task 9: Demand, suppliers and orders UI

**Files:**
- Create: `src/components/StatusBadge.tsx`
- Create: `src/components/VirtualTable.tsx`
- Create: `src/components/FiltersBar.tsx`
- Create: `src/features/demand/DemandPage.tsx`
- Create: `src/features/suppliers/SuppliersPage.tsx`
- Create: `src/features/orders/OrdersPage.tsx`
- Create: `src/features/orders/OrderDrawer.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/ui/demandPage.test.tsx`
- Test: `tests/ui/suppliersPage.test.tsx`
- Test: `tests/ui/ordersPage.test.tsx`

**Interfaces:**
- Pages consume store selectors/actions only.

- [ ] **Step 1: StatusBadge**

Use exact colors from UX spec and Russian labels. Test BELOW_MIN text is present independent of CSS.

- [ ] **Step 2: Branch and network demand views**

Implement exact KPI/table columns from UX spec. `Все` groups by SKU, uses specified worst-status severity and expandable branch rows. Default view only shows deficit items.

- [ ] **Step 3: Suppliers workspace**

Show supplier totals, threshold state, unresolved SKU and `MANUAL_REQUIRED` candidates. Candidate selection persists immediately; show purchaseQty, purchaseAmount, weightedUnitCost and recommendation.

- [ ] **Step 4: Global filters**

Implement search, status, branch, supplier, money range, minimum order amount, threshold mode, `Показывать ниже порога`, `Только попадающие в заказ`. Persist minimum amount and threshold mode.

- [ ] **Step 5: Orders matrix and drawer**

Rows suppliers, columns branches, cell shows total+SKU count+state. Drawer exposes editable quantity. Input accepts `>=0`, displays warning above calculated quantity, immediately updates all totals.

- [ ] **Step 6: Virtualize long tables and test interactions**

Commit: `feat: add demand supplier and order workspaces`.

---

### Task 10: CSV, ZIP and supplier XLSX export

**Files:**
- Create: `src/export/filenames.ts`
- Create: `src/export/csv.ts`
- Create: `src/export/supplierWorkbook.ts`
- Create: `src/export/download.ts`
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify: `src/features/orders/OrderDrawer.tsx`
- Test: `tests/export/csv.test.ts`
- Test: `tests/export/supplierWorkbook.test.ts`

**Interfaces:**
- `orderToCsv(order: Order): string`
- `buildSupplierWorkbook(supplier: string, orders: Order[]): Promise<ArrayBuffer>`
- `downloadReadyOrdersZip(orders: Order[]): Promise<void>`

- [ ] **Step 1: Implement CSV after failing exact-output tests**

Output starts with UTF-8 BOM and exact header:

```text
Код;Артикул;Номенклатура;Подразделение;Поставщик;Количество;Ед.;Цена;Сумма\r\n
```

Use semicolon, CRLF and quote escaping for semicolon/quote/newline. Export `orderQty`.

- [ ] **Step 2: Implement filename/sheet-name sanitizers with tests**

Windows filename invalid chars `<>:"/\\|?*`→`_`; trim trailing dot/space. Sheet names remove `[]:*?/\\`, max 31 chars, resolve collisions with stable numeric suffix.

- [ ] **Step 3: Implement ExcelJS workbook and round-trip test**

`Общий заказ`: KPI block + one aggregated row per SKU. Branch sheets: only branches with positive qty. Freeze panes, bold headers, autofilter, RUB `#,##0.00`, qty `#,##0.###`, fixed readable widths. Re-open generated buffer in test and assert sheet names, quantities and sums.

- [ ] **Step 4: Export guards**

Hard block unresolved supplier and missing price. Below-threshold export requires explicit warning confirmation as allowed by UX spec. On successful order export mark EXPORTED in current session only.

- [ ] **Step 5: Add all-CSV ZIP and supplier workbook buttons**

Commit: `feat: export branch orders and supplier workbooks`.

---

### Task 11: Full workflow verification and release hardening

**Files:**
- Create: `tests/ui/fullWorkflow.test.tsx`
- Modify implementation files only for defects revealed by verification.

**Interfaces:**
- Produces verified local `dist/index.html`; `dist` remains gitignored.

- [ ] **Step 1: End-to-end synthetic UI test**

Upload generated Min-Max + supplier files, resolve one multi-supplier SKU manually, set threshold 10,000, switch threshold mode, edit orderQty, assert order matrix totals and export payloads.

- [ ] **Step 2: Spec coverage audit**

For every numbered acceptance criterion, identify its automated test. Add a missing test before continuing; do not mark a rule covered by manual inspection when it can be deterministic.

- [ ] **Step 3: Clean install verification**

```bash
npm ci
npm run verify
```

Expected: typecheck PASS, all tests PASS, one-file build PASS.

- [ ] **Step 4: Manual `file://` smoke**

Open `dist/index.html` directly in current Chrome/Edge. Verify file inputs, navigation, IndexedDB override persistence, CSV, ZIP and XLSX downloads with no dev server and no network.

- [ ] **Step 5: Real private-report smoke when files are locally available**

Use only `samples/private/`. Verify branch detection, random `MAX-stock` calculations, supplier candidates, unresolved visibility and exports. Never git-add or copy real report rows into logs/docs.

- [ ] **Step 6: Final commit**

Commit: `test: verify complete orders auto workflow`.

## Final Definition of Done

- `npm run verify` is green on a clean install.
- `dist/index.html` is the only production artifact and opens through `file://`.
- Both `.xls` and `.xlsx` supplier fixtures pass.
- Min-Max grouping rows are not misclassified as SKU.
- All status boundaries and BELOW_MIN override are tested.
- Unresolved/multiple suppliers remain visible and are never silently assigned.
- Both threshold modes are tested.
- CSV/XLSX round-trip tests pass.
- Main workflow is covered by integration test.
- Git history contains no real company report or private row data.
