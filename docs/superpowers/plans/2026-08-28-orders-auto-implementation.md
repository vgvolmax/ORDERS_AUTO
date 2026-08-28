# ORDERS_AUTO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a serverless Russian-language HTML application that converts Min-Max and supplier 1C reports into validated purchase orders grouped by branch and supplier, with CSV/XLSX export.

**Architecture:** Modular React/TypeScript source with pure domain functions and parser/export adapters. Runtime is fully client-side; persisted user decisions live in IndexedDB. Vite produces one self-contained HTML artifact via `vite-plugin-singlefile`.

**Tech Stack:** React, TypeScript strict, Vite, `vite-plugin-singlefile`, `xlsx`, `exceljs`, `jszip`, `idb`, TanStack Table/Virtual, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-28-orders-auto-design.md`

## Global Constraints

- No backend, local server, SQLite, telemetry, CDN, or runtime network API.
- Production output is one `dist/index.html` that works via `file://` in current Chrome/Edge.
- Join reports only by 1C code.
- Real company reports are never committed.
- TypeScript `strict: true`; business rules are pure functions outside React.
- Russian UI; desktop-first from 1280 px.
- Follow exact rules in `docs/product/SPEC.md`, `docs/data/DATA_CONTRACTS.md`, `docs/ux/UX_AND_EXPORT.md`.

---

### Task 1: Project scaffold and single-file build

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

**Interfaces:**
- Produces scripts `dev`, `typecheck`, `test`, `build`, `verify` used by all later tasks.

- [ ] **Step 1: Create package metadata and scripts**

Use Node >=20 and these dependency families:

```json
{
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "build": "vite build && node scripts/assert-single-file.mjs",
    "verify": "npm run typecheck && npm test -- --run && npm run build"
  }
}
```

Runtime dependencies: `react`, `react-dom`, `xlsx`, `exceljs`, `jszip`, `idb`, `@tanstack/react-table`, `@tanstack/react-virtual`. Dev dependencies: Vite/React plugin, TypeScript, `vite-plugin-singlefile`, Vitest, jsdom, Testing Library + user-event, ESLint if desired.

- [ ] **Step 2: Configure strict TypeScript and test environment**

`tsconfig.json` must include:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 3: Configure one-file production build**

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] }
});
```

- [ ] **Step 4: Add artifact assertion**

`scripts/assert-single-file.mjs` must fail unless `dist` contains exactly `index.html` and the HTML has no external JS/CSS references:

```js
import fs from 'node:fs';
const files = fs.readdirSync('dist');
if (files.length !== 1 || files[0] !== 'index.html') throw new Error(`Expected only dist/index.html, got: ${files.join(', ')}`);
const html = fs.readFileSync('dist/index.html', 'utf8');
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet/i.test(html)) throw new Error('Build is not self-contained');
```

- [ ] **Step 5: Add minimal smoke test, run and commit**

```tsx
// tests/ui/appSmoke.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';
it('shows import heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /формирование заказов/i })).toBeInTheDocument();
});
```

Run `npm run verify`; expected PASS and one `dist/index.html`.

Commit: `chore: scaffold client-only single-file app`.

---

### Task 2: Domain types and value normalization

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/normalize.ts`
- Test: `tests/domain/normalize.test.ts`

**Interfaces:**
- Produces all types from `docs/data/DATA_CONTRACTS.md`.
- Produces `normalizeText(value): string`, `parseOptionalNumber(value): number | null`, `parseStockNumber(value): number`.

- [ ] **Step 1: Write normalization tests**

```ts
import { normalizeText, parseOptionalNumber, parseStockNumber } from '../../src/domain/normalize';

test('normalizes NBSP and whitespace', () => expect(normalizeText('  Наро\u00A0-Фоминск  ')).toBe('Наро -Фоминск'));
test('parses comma decimal', () => expect(parseOptionalNumber('1 234,50')).toBe(1234.5));
test('blank optional number is null', () => expect(parseOptionalNumber(' ')).toBeNull());
test('blank branch stock is zero', () => expect(parseStockNumber(' ')).toBe(0));
```

- [ ] **Step 2: Verify tests fail, then implement**

```ts
export function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
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

- [ ] **Step 3: Define types exactly as DATA_CONTRACTS, run tests/typecheck and commit**

Commit: `feat: add normalized domain contracts`.

---

### Task 3: Min-Max workbook parser

**Files:**
- Create: `src/import/workbook.ts`
- Create: `src/import/minMaxParser.ts`
- Create: `tests/fixtures/workbookBuilders.ts`
- Test: `tests/import/minMaxParser.test.ts`

**Interfaces:**
- Produces `parseMinMaxWorkbook(input: ArrayBuffer): ParseResult<MinMaxDataset>`.
- `ParseResult<T> = { data: T | null; issues: ValidationIssue[]; fatal: boolean }`.

- [ ] **Step 1: Build synthetic workbook generator**

Use SheetJS in tests so fixtures are generated in memory, including category rows, SKU row and branch detail rows:

```ts
export function buildMinMaxXlsx(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TDSheet');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
```

- [ ] **Step 2: Write tests for group-row rejection and SKU-block detection**

```ts
const buffer = buildMinMaxXlsx([
 ['Код','Артикул','Номенклатура','Количество (в еденицах хранения)','Минимальный остаток','Максимальный остаток','Цена'],
 ['GROUP',null,'Батарейки',100,null,1000,500],
 ['SKU1','A-1','Товар 1',10,2,8,100],
 [null,null,'Ленина',3,2,8,null],
 [null,null,'Ступино',' ',2,8,null]
]);
const result = parseMinMaxWorkbook(buffer);
expect(result.data?.skus.map(x => x.code)).toEqual(['SKU1']);
expect(result.data?.branchStocks).toHaveLength(2);
expect(result.data?.branchStocks.find(x => x.branch === 'Ступино')?.stock).toBe(0);
```

Also add tests for duplicate branch, null MAX, dynamic new branch and total mismatch.

- [ ] **Step 3: Implement workbook adapter**

```ts
export function readFirstSheetRows(input: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(input, { type: 'array', cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[first]!, { header: 1, raw: true, defval: null });
}
```

- [ ] **Step 4: Implement block parser**

Scan rows once. A coded row becomes SKU only when its following rows before the next coded row contain >=1 branch candidate. Preserve code as text. Emit `TOTAL_STOCK_MISMATCH`, `DUPLICATE_SKU_BRANCH`, `INVALID_NORM`, `MISSING_REFERENCE_PRICE` according to contracts. Do not use parent total in demand.

Core shape:

```ts
export function parseMinMaxWorkbook(input: ArrayBuffer): ParseResult<MinMaxDataset> {
  const rows = readFirstSheetRows(input);
  // resolve header indexes by normalized header names
  // scan coded rows and following detail blocks
  // validate, deduplicate branches list, return normalized data
}
```

- [ ] **Step 5: Run focused tests, full verify and commit**

Commit: `feat: parse hierarchical min-max reports`.

---

### Task 4: Supplier `.xls/.xlsx` parser and aggregation

**Files:**
- Create: `src/import/supplierParser.ts`
- Modify: `tests/fixtures/workbookBuilders.ts`
- Test: `tests/import/supplierParser.test.ts`

**Interfaces:**
- Produces `parseSupplierWorkbook(input: ArrayBuffer): ParseResult<{ history: SupplierHistory[] }>`.

- [ ] **Step 1: Extend fixture builder to write both formats**

```ts
export function buildSupplierWorkbook(rows: unknown[][], bookType: 'xls' | 'xlsx'): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TDSheet');
  return XLSX.write(wb, { type: 'array', bookType });
}
```

- [ ] **Step 2: Test flat and grouped layouts**

Flat example:

```ts
[
 ['Контрагент','Код','Номенклатура','Количество','Стоимость','Ед. изм.'],
 ['Поставщик А','SKU1','Товар 1',5,500,'шт']
]
```

Grouped example:

```ts
[
 ['Контрагент','Код','Номенклатура','Количество','Стоимость','Ед. изм.'],
 ['Поставщик А',null,null,null,null,null],
 [null,'SKU1','Товар 1',2,220,'шт'],
 [null,'SKU1','Товар 1',3,330,'шт'],
 ['Итого',null,null,5,550,null]
]
```

Expect one history record with `purchaseQty=5`, `purchaseAmount=550`, `weightedUnitCost=110`.

- [ ] **Step 3: Implement alias-based header detection**

Normalize header strings and resolve indexes using aliases from `DATA_CONTRACTS.md`. If required code/quantity/amount structure cannot be identified, return fatal `MISSING_REQUIRED_COLUMN`.

- [ ] **Step 4: Implement grouped supplier state and aggregation**

Use `currentSupplier`. A row with supplier text and blank skuCode sets it. A valid item row requires skuCode and at least one numeric quantity/amount. Ignore names normalized to `итого`/`всего`. Aggregate by `${supplier}\u0000${skuCode}`.

- [ ] **Step 5: Test true BIFF8 generation, run verify and commit**

Commit: `feat: parse supplier history from xls and xlsx`.

---

### Task 5: Demand engine and network aggregates

**Files:**
- Create: `src/domain/demand.ts`
- Test: `tests/domain/demand.test.ts`

**Interfaces:**
- Produces `calculateStockStatus(stock, min, max): { status: StockStatus; deficitQty: number; deficitPct: number | null }`.
- Produces `calculateDemand(dataset: MinMaxDataset): DemandLine[]`.

- [ ] **Step 1: Encode all boundary tests from ACCEPTANCE_CRITERIA**

```ts
expect(calculateStockStatus(40,20,40).status).toBe('OK');
expect(calculateStockStatus(30,20,40).status).toBe('YELLOW');
expect(calculateStockStatus(29,20,40).status).toBe('ORANGE');
expect(calculateStockStatus(19,20,40).status).toBe('BELOW_MIN');
expect(calculateStockStatus(5,null,40).status).toBe('LIGHT_RED');
expect(calculateStockStatus(5,50,40).status).toBe('INVALID_NORM');
```

- [ ] **Step 2: Implement ordered status rules**

```ts
export function calculateStockStatus(stock: number, min: number | null, max: number | null) {
  if (max == null || max <= 0) return { status: 'NO_NORM' as const, deficitQty: 0, deficitPct: null };
  if (min != null && min > max) return { status: 'INVALID_NORM' as const, deficitQty: 0, deficitPct: null };
  const deficitQty = Math.max(0, max - stock);
  if (stock >= max) return { status: 'OK' as const, deficitQty: 0, deficitPct: 0 };
  const deficitPct = deficitQty / max;
  if (min != null && stock < min) return { status: 'BELOW_MIN' as const, deficitQty, deficitPct };
  if (deficitPct <= 0.25) return { status: 'YELLOW' as const, deficitQty, deficitPct };
  if (deficitPct <= 0.75) return { status: 'ORANGE' as const, deficitQty, deficitPct };
  return { status: 'LIGHT_RED' as const, deficitQty, deficitPct };
}
```

- [ ] **Step 3: Implement network aggregate in O(n)**

First sum deficit by skuCode in a Map, then project DemandLine with `networkDeficitQty`; never call `filter/find` over all lines per row.

- [ ] **Step 4: Run tests and commit**

Commit: `feat: calculate branch and network replenishment demand`.

---

### Task 6: Supplier resolution, price resolution and IndexedDB overrides

**Files:**
- Create: `src/domain/suppliers.ts`
- Create: `src/persistence/db.ts`
- Create: `src/persistence/supplierOverrides.ts`
- Create: `src/persistence/settings.ts`
- Test: `tests/domain/suppliers.test.ts`
- Test: `tests/persistence/persistence.test.ts`

**Interfaces:**
- Produces `resolveSuppliers(history, overrides): SupplierResolution[]`.
- Produces `resolveUnitPrice(resolution, referencePrice): { unitPrice: number | null; priceSource: PriceSource; unit: string | null }`.
- Persistence: `getSupplierOverrides()`, `saveSupplierOverride()`, `getSettings()`, `saveSettings()`.

- [ ] **Step 1: Write supplier resolution tests**

```ts
expect(resolveOne([], []).status).toBe('UNRESOLVED');
expect(resolveOne([candidateA], []).status).toBe('AUTO_SINGLE');
const multi = resolveOne([candidateA, candidateB], []);
expect(multi.status).toBe('MANUAL_REQUIRED');
expect(multi.selectedSupplier).toBeNull();
```

Recommendation sort: purchaseQty desc, then purchaseAmount desc, then supplier localeCompare for deterministic tie.

- [ ] **Step 2: Implement resolution without auto-selecting multiple candidates**

Persisted override is accepted only when that supplier exists in current candidates. Otherwise `STALE_OVERRIDE`.

- [ ] **Step 3: Write and implement price fallback tests**

```ts
expect(resolveUnitPrice(singleResolution, 150)).toMatchObject({ unitPrice: 110, priceSource: 'SUPPLIER_HISTORY' });
expect(resolveUnitPrice(unpricedResolution, 150)).toMatchObject({ unitPrice: 150, priceSource: 'MIN_MAX_FALLBACK' });
expect(resolveUnitPrice(unpricedResolution, null).priceSource).toBe('MISSING');
```

- [ ] **Step 4: Implement IndexedDB schema**

Use `idb.openDB('orders-auto', 1, ...)` with stores `supplierOverrides` (keyPath `skuCode`) and `settings` (key `app`). Store no raw workbook bytes.

- [ ] **Step 5: Test using fake IndexedDB in jsdom test environment if needed, run verify and commit**

Commit: `feat: resolve suppliers prices and persisted choices`.

---

### Task 7: Order projection, manual quantities and threshold modes

**Files:**
- Create: `src/domain/orders.ts`
- Test: `tests/domain/orders.test.ts`

**Interfaces:**
- Produces `buildOrders(demand, skus, history, resolutions, edits, settings): Order[]`.
- Produces stable order id `makeOrderId(branch, supplier): string`.

- [ ] **Step 1: Write baseline order test**

Given two deficit lines for same supplier/branch, expect one order with two lines, each `orderQty=deficitQty`, total sum equal line sums.

- [ ] **Step 2: Implement line construction and blockers**

Only demand with `deficitQty > 0` and valid norm may become order lines. Unresolved supplier demand must not disappear: expose it through a separate `unassigned` projection or blocked collection consumed by UI.

Line amount:

```ts
const amount = unitPrice == null ? null : orderQty * unitPrice;
```

Order `totalAmount=null` if any positive-qty line has missing price.

- [ ] **Step 3: Add manual edit behavior tests**

```ts
const edits = [{ skuCode:'SKU1', branch:'Ленина', qty:12 }];
const order = build(..., edits, ...)[0]!;
expect(order.lines[0]!.orderQty).toBe(12);
expect(order.lines[0]!.warnings).toContain('ABOVE_CALCULATED_QTY');
```

Reject negative edit before storing it.

- [ ] **Step 4: Implement both threshold modes**

For `SUPPLIER_TOTAL`, first compute supplier totals across orders, then set `belowThreshold` on all that supplier's orders from supplier total. For `BRANCH_SUPPLIER`, compare each order independently.

- [ ] **Step 5: Derive READY/BLOCKED deterministically, run tests and commit**

Commit: `feat: build editable orders and threshold rules`.

---

### Task 8: Application store and import workflow UI

**Files:**
- Create: `src/app/appStore.ts`
- Create: `src/app/selectors.ts`
- Create: `src/features/import/ImportPage.tsx`
- Create: `src/components/KpiCard.tsx`
- Modify: `src/app/App.tsx`
- Test: `tests/ui/importWorkflow.test.tsx`

**Interfaces:**
- Store actions: `loadMinMaxFile(file)`, `loadSupplierFile(file)`, `commitImports()`, `setSupplierOverride()`, `setOrderQty()`, `setSettings()`.
- Selectors return derived demand/resolutions/orders; components never recalculate formulas.

- [ ] **Step 1: Write UI integration test with synthetic File objects**

```tsx
render(<App />);
await user.upload(screen.getByLabelText(/min-max/i), minMaxFile);
await user.upload(screen.getByLabelText(/поставщики/i), supplierFile);
expect(await screen.findByText(/2 подразделения/i)).toBeInTheDocument();
expect(screen.getByRole('button', { name:/перейти к потребности/i })).toBeEnabled();
```

- [ ] **Step 2: Implement import state and parsing**

Use `await file.arrayBuffer()`; call parser functions; show filename, counts, fatal/warning summaries. Keep both parsed datasets in memory.

- [ ] **Step 3: Load persisted overrides/settings once on app startup**

Do not block initial render forever; show compact loading state while IndexedDB opens.

- [ ] **Step 4: Implement dynamic post-import navigation model and commit**

Commit: `feat: add report import and application state`.

---

### Task 9: Demand, suppliers and orders workspaces

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
- Pages consume selectors/store actions only.
- `StatusBadge({status})` renders both color token and Russian text.

- [ ] **Step 1: Implement status badge with exact tokens**

Map labels:

```ts
const labels = {
  OK:'В норме', YELLOW:'До MAX ≤25%', ORANGE:'До MAX 25–75%',
  LIGHT_RED:'До MAX >75%', BELOW_MIN:'Ниже MIN', NO_NORM:'Нет норматива', INVALID_NORM:'Ошибка MIN/MAX'
};
```

Test that `BELOW_MIN` is accessible by text, not color only.

- [ ] **Step 2: Implement branch DemandPage**

Render KPIs and exact columns from UX spec. Default filter excludes zero deficit/no norm. Money KPI sums known amounts and explicitly displays missing-price count.

- [ ] **Step 3: Implement network `Все` mode**

Group by SKU, compute worst status with specified severity order, expandable branch details.

- [ ] **Step 4: Implement SuppliersPage resolution blocks**

For `MANUAL_REQUIRED`, render candidates with qty/amount/unit price and save dropdown choice through store + IndexedDB. Unresolved SKU has separate visible section.

- [ ] **Step 5: Implement threshold/filter controls**

Persist minimum amount/mode; add `Показывать ниже порога`.

- [ ] **Step 6: Implement Orders matrix and editable drawer**

Rows supplier, columns branches, cell total + SKU count + state. Drawer quantity input must reject negatives and show warning above calculated qty.

- [ ] **Step 7: Virtualize long tables, run UI tests and commit**

Commit: `feat: add demand supplier and order workspaces`.

---

### Task 10: CSV, ZIP and supplier Excel export

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
- `orderToCsv(order): string` includes BOM.
- `buildSupplierWorkbook(supplier, orders): Promise<ArrayBuffer>`.
- `downloadReadyOrdersZip(orders): Promise<void>`.

- [ ] **Step 1: Write exact CSV serialization test**

Expected starts with:

```text
\uFEFFКод;Артикул;Номенклатура;Подразделение;Поставщик;Количество;Ед.;Цена;Сумма\r\n
```

Implement RFC4180-style quote escaping for semicolon/newline/quotes.

- [ ] **Step 2: Implement stable filename sanitization**

Replace Windows-invalid `<>:"/\\|?*` with `_`, trim trailing dots/spaces, preserve readable Cyrillic.

- [ ] **Step 3: Write supplier workbook round-trip test**

After generation, load buffer using ExcelJS or SheetJS and assert `Общий заказ` plus branch sheets, aggregate qty/sums and unique <=31-char sheet names.

- [ ] **Step 4: Implement styled ExcelJS workbook**

`Общий заказ`: KPI rows + aggregate table. Branch sheets: line table. Apply freeze panes, bold header fill, autofilter, RUB format `#,##0.00`, quantity format `#,##0.###`, reasonable widths.

- [ ] **Step 5: Add UI export guards**

Hard-disable unresolved supplier/missing price. Allow explicit warning confirmation only where UX spec permits. After success mark order `EXPORTED` in session.

- [ ] **Step 6: Implement all-CSV ZIP and supplier XLSX buttons, run tests and commit**

Commit: `feat: export branch orders and supplier workbooks`.

---

### Task 11: End-to-end hardening and release verification

**Files:**
- Modify: `src/**/*` only for defects found by verification
- Create: `tests/ui/fullWorkflow.test.tsx`
- Modify: `README.md` only if run instructions need exact final command

**Interfaces:**
- Produces final verified `dist/index.html` locally; `dist` remains gitignored.

- [ ] **Step 1: Add complete synthetic workflow test**

The test must upload generated Min-Max + supplier workbook, enter a manual supplier choice for multi-candidate SKU, set threshold 10,000, switch threshold mode, edit qty, and verify export functions are invoked with the expected order model.

- [ ] **Step 2: Audit spec coverage**

For every section in `SPEC.md` and `ACCEPTANCE_CRITERIA.md`, point to an automated test or explicit manual smoke item. Add missing tests before proceeding.

- [ ] **Step 3: Run full verification**

```bash
npm ci
npm run verify
```

Expected: typecheck PASS, all tests PASS, build PASS, single-file assertion PASS.

- [ ] **Step 4: Manual file:// smoke**

Open `dist/index.html` directly (not Vite preview) in Chrome/Edge. Verify file inputs, navigation, IndexedDB supplier override persistence, CSV download and XLSX download.

- [ ] **Step 5: Real private-report smoke if files are locally available**

Copy reports into `samples/private/` without git add. Check branch count, random `MAX-stock` calculations, supplier candidates, unresolved list and exports. Never paste/report sensitive row content into git.

- [ ] **Step 6: Final commit**

Commit: `test: verify complete orders auto workflow`.

## Final Definition of Done

- `npm run verify` is green.
- `dist/index.html` is the only production artifact and opens through `file://`.
- Both `.xls` and `.xlsx` supplier fixtures pass.
- Min-Max grouping rows are not misclassified as SKU.
- All status boundaries and BELOW_MIN override are tested.
- Multiple supplier selection is never silently auto-resolved.
- Both threshold modes are tested.
- CSV/XLSX outputs round-trip successfully.
- Main workflow is covered by integration test.
- No real report or company data exists in git history.
