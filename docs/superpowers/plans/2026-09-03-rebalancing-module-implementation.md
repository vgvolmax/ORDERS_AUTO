# Rebalancing Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в ORDERS_AUTO отдельный модуль «Ребалансировка», который предлагает и редактирует внутренние перемещения только из остатка сверх MAX, показывает финансовый эффект и трудозатраты, позволяет настроить симметричную географию связок, а после явного утверждения уменьшает закупочную потребность и downstream-заказы.

**Architecture:** Исходная `PricedDemandLine[]` остаётся неизменяемой физической потребностью. Новый pure-domain слой строит auto proposal → draft scenario → approved plan; отдельная residual purchase projection уменьшает закупку только на approved incoming transfers и уже она передаётся в `buildOrderProjection()`. Geography settings сохраняются в IndexedDB, proposal/draft/approved plan живут только в текущем import snapshot/session. UI получает отдельный top-level workspace с flow-map, доступным route-list fallback, inspector, manual transfer builder и geography matrix.

**Tech Stack:** существующие React 19, TypeScript strict, Vite, IndexedDB через `idb`, Vitest, React Testing Library, Playwright, CSS/SVG без внешнего graph/map engine. Новые runtime dependencies не добавлять.

**Spec:** `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md`

## Global Constraints

- Донор отдаёт только `max(0, stock - MAX)`; после любого auto/manual transfer `stockAfterOutgoing >= MAX`.
- Получатель не получает больше `max(0, MAX - stock)`.
- `NO_NORM` и `INVALID_NORM` не участвуют ни в auto, ни в manual rebalance.
- Geography relation симметрична и имеет ровно три значения: `PRIORITY`, `ALLOWED`, `MANUAL_ONLY`.
- `MANUAL_ONLY` никогда не используется автоматом; ручное исключение не меняет глобальную geography setting.
- Priority modes: `CRITICALITY_FIRST` и `GEOGRAPHY_FIRST`; не вводить общий weighted score.
- Базовая decision-unit Pareto = `SKU × recipient branch`; grouping `SKU` аналитический и не запускает второй allocation engine.
- Финансовая формулировка: `Сокращение закупки`, не `Экономия`.
- Трудозатраты: `маршруты + SKU-линии + единицы`; искусственный labor score запрещён.
- Только approved plan влияет на supplier/order projection; proposal и draft не меняют заказы.
- Исходный `deficitQty` не мутировать. Downstream использует отдельный `residualPurchaseQty`.
- Новая загрузка входных отчётов сбрасывает proposal/draft/approved session state, но сохраняет geography settings.
- Runtime остаётся полностью offline/static и запускается через `file://`; никаких runtime HTTP/HTTPS, CDN, telemetry, backend или solver API.
- UI русский, desktop-first от 1280 px, WCAG 2.2 AA baseline, color is never the only signal.
- Flow-map обязан иметь keyboard-accessible route-list fallback; drag, если появится, только как progressive enhancement.
- Следовать `DESIGN.md`; flow-map — единственный выразительный signature-element, остальные control/table surfaces остаются в существующем языке ORDERS_AUTO.
- Не использовать `window.alert`, `window.confirm`, `window.prompt` в новом workflow. Общий dialog owner — app-owned styled native `<dialog>`.
- Для каждого доменного правила: RED test → minimal implementation → GREEN → commit.
- После каждого законченного task минимум: `npm run typecheck`, focused tests. Перед merge: `npm run verify` и `npm run test:e2e`.

## Target file map

```text
src/domain/
  geography.ts                  # symmetric pair key + relation lookup
  rebalance.ts                  # automatic proposal + invariants + summaries
  rebalanceScenario.ts          # Pareto subset, edits, exclusions, manual transfers
  residualDemand.ts             # approved plan -> residual purchase lines
  rebalanceWorkflow.ts          # approval impact/invalidation helpers
  types.ts                      # shared rebalance/residual contracts

src/persistence/
  db.ts                         # IndexedDB v2 + geographyPairs store
  geographySettings.ts          # load/save pair settings

src/features/rebalance/
  RebalancePage.tsx             # workspace orchestration
  RebalanceKpis.tsx             # purchase/effort summary
  RebalanceFilters.tsx          # presentation-only filters
  RebalanceFlowMap.tsx          # topological visual map
  RebalanceRouteList.tsx        # accessible equivalent of map
  flowLayout.ts                 # deterministic map coordinates
  rebalanceView.ts              # route aggregation/filter view model
  RouteInspector.tsx            # route SKU editing
  ManualTransferBuilder.tsx     # explicit manual add path
  GeographySettingsDialog.tsx   # symmetric matrix + bulk editing

src/components/
  AppDialog.tsx                 # shared app-owned modal owner

existing integration owners:
  src/app/App.tsx
  src/app/appStore.ts
  src/app/selectors.ts
  src/features/import/ImportPage.tsx
  src/features/demand/DemandPage.tsx
  src/features/orders/OrdersPage.tsx
  src/features/suppliers/SuppliersPage.tsx
  src/styles/app.css
```

---

### Task 1: Promote the approved design into authoritative product contracts

**Files:**
- Modify: `docs/product/SPEC.md`
- Modify: `docs/data/DATA_CONTRACTS.md`
- Modify: `docs/data/DERIVED_PROJECTIONS.md`
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/ux/UX_AND_EXPORT.md`
- Modify: `docs/testing/ACCEPTANCE_CRITERIA.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: approved design spec `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md`.
- Produces: authoritative contracts that runtime implementation in Tasks 2–13 must follow.

- [ ] **Step 1: Update the product flow and invariants in `SPEC.md`**

Insert a new section after demand calculation with the exact business chain:

```md
## Ребалансировка перед закупкой

Потребность до MAX сначала проходит через модуль внутренних перемещений.
Донор может отдавать только `max(0, stock - MAX)` и после перемещения
обязан оставаться не ниже MAX. Получатель может получить не больше gap до MAX.

Связи подразделений симметричны:
`Приоритетно / Допустимо / Только вручную`.
`Только вручную` исключено из автоматического proposal.

Только утверждённый plan уменьшает внешнюю закупку:

residualPurchaseQty = max(0, deficitQty - approvedIncomingQty)
```

Also state that `NO_NORM/INVALID_NORM` cannot participate, proposal/draft do not affect orders, and geography settings are persistent while plans are import-snapshot state.

- [ ] **Step 2: Add exact domain contracts to `DATA_CONTRACTS.md`**

Document the types from Task 2 verbatim, including `RebalanceRelation`, `GeographyPairSetting`, `RebalancePriorityMode`, `RebalanceTransfer`, `RebalancePlan`, `RebalanceDraftState`, `ResidualPurchaseLine` and the unordered geography-pair key rule.

- [ ] **Step 3: Document derived graph order in `DERIVED_PROJECTIONS.md`**

Add this projection graph:

```text
PricedDemandLine[]
  ├─> RebalanceProposal
  │     └─> RebalanceScenario
  │           └─(approve)─> ApprovedRebalancePlan
  └─> buildResidualPurchaseDemand(approvedPlan)
          └─> PurchaseDemandLine[]
                  └─> buildOrderProjection()
```

Explicitly state that `deficitQty` remains the original physical gap and `residualPurchaseQty` is the purchase quantity.

- [ ] **Step 4: Update architecture ownership**

Add `geography.ts`, `rebalance.ts`, `rebalanceScenario.ts`, `residualDemand.ts`, `rebalanceWorkflow.ts`, persistence ownership and the `features/rebalance/` boundary to `ARCHITECTURE.md`. Keep the offline/static deployment contract unchanged.

- [ ] **Step 5: Update UX and acceptance docs**

Copy only approved observable behavior from the design spec: navigation position, KPI wording, modes, Pareto targets, flow-map + route list, inspector, manual-only warning, geography matrix, approval lifecycle, downstream transparency, empty/error states and test invariants.

- [ ] **Step 6: Update `AGENTS.md` reading order**

Add `DESIGN.md` and the approved rebalancing spec before the implementation plan, and replace the old single implementation-plan pointer with both current plans:

```md
7. `DESIGN.md`
8. `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md`
9. `docs/superpowers/plans/2026-09-03-rebalancing-module-implementation.md`
```

Do not remove the existing base product documents.

- [ ] **Step 7: Verify documentation consistency**

Run:

```bash
git diff --check
rg -n "донор|MAX|MANUAL_ONLY|residualPurchaseQty|Сокращение закупки" docs AGENTS.md
```

Expected: no contradictory rule that allows a donor below MAX or automatic `MANUAL_ONLY`.

- [ ] **Step 8: Commit**

```bash
git add docs AGENTS.md
git commit -m "docs: promote rebalancing contracts"
```

---

### Task 2: Add domain contracts, symmetric geography rules and persistence

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/geography.ts`
- Modify: `src/persistence/db.ts`
- Create: `src/persistence/geographySettings.ts`
- Create: `tests/domain/geography.test.ts`
- Modify: `tests/persistence/persistence.test.ts`

**Interfaces:**
- Produces: `geographyPairKey()`, `getRebalanceRelation()`, `getGeographySettings()`, `saveGeographySettings()`.
- Later tasks consume the exact types below.

- [ ] **Step 1: Write failing geography tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  geographyPairKey,
  getRebalanceRelation,
} from '../../src/domain/geography';

it('uses one symmetric key for both directions', () => {
  expect(geographyPairKey('Рязань', 'Коломна')).toBe(
    geographyPairKey('Коломна', 'Рязань'),
  );
});

it('defaults unknown pairs to MANUAL_ONLY', () => {
  expect(getRebalanceRelation([], 'Рязань', 'Коломна')).toBe('MANUAL_ONLY');
});

it('reads a saved relation in both directions', () => {
  const settings = [
    { branchA: 'Рязань', branchB: 'Коломна', relation: 'PRIORITY' as const },
  ];
  expect(getRebalanceRelation(settings, 'Коломна', 'Рязань')).toBe('PRIORITY');
});
```

Run:

```bash
npm test -- --run tests/domain/geography.test.ts
```

Expected: FAIL because module/types do not exist.

- [ ] **Step 2: Add exact shared types to `src/domain/types.ts`**

```ts
export type RebalanceRelation = 'PRIORITY' | 'ALLOWED' | 'MANUAL_ONLY';
export type RebalancePriorityMode = 'CRITICALITY_FIRST' | 'GEOGRAPHY_FIRST';
export type RebalanceTransferSource = 'AUTO' | 'MANUAL';
export type RebalanceParetoTarget = 80 | 90 | 95 | 100;

export interface GeographyPairSetting {
  branchA: string;
  branchB: string;
  relation: RebalanceRelation;
}

export interface RebalanceTransfer {
  skuCode: string;
  article: string | null;
  name: string;
  fromBranch: string;
  toBranch: string;
  qty: number;
  relation: RebalanceRelation;
  source: RebalanceTransferSource;
  recipientStatus: StockStatus;
  unitPrice: number | null;
  purchaseReductionAmount: number | null;
}

export interface RebalanceSummary {
  transferCount: number;
  routeCount: number;
  skuCount: number;
  recipientLineCount: number;
  totalQty: number;
  knownPurchaseReductionAmount: number;
  missingPriceTransferCount: number;
  residualKnownPurchaseAmount: number;
  residualMissingPriceLineCount: number;
}

export interface RebalancePlan {
  mode: RebalancePriorityMode;
  transfers: RebalanceTransfer[];
  summary: RebalanceSummary;
}

export interface RebalanceQtyEdit {
  transferKey: string;
  qty: number;
}

export interface ManualRebalanceTransferInput {
  skuCode: string;
  fromBranch: string;
  toBranch: string;
  qty: number;
}

export interface RebalanceDraftState {
  paretoTarget: RebalanceParetoTarget;
  excludedTransferKeys: string[];
  qtyEdits: RebalanceQtyEdit[];
  manualTransfers: ManualRebalanceTransferInput[];
}

export interface PurchaseDemandLine extends PricedDemandLine {
  approvedIncomingQty: number;
  residualPurchaseQty: number;
  residualPurchaseAmount: number | null;
}
```

- [ ] **Step 3: Implement the symmetric geography owner**

```ts
import { normalizeKey } from './normalize';
import type { GeographyPairSetting, RebalanceRelation } from './types';

export function geographyPairKey(branchA: string, branchB: string): string {
  const pair = [normalizeKey(branchA), normalizeKey(branchB)].sort((a, b) =>
    a.localeCompare(b, 'ru-RU'),
  );
  return `${pair[0]}\0${pair[1]}`;
}

export function getRebalanceRelation(
  settings: GeographyPairSetting[],
  branchA: string,
  branchB: string,
): RebalanceRelation {
  const key = geographyPairKey(branchA, branchB);
  return (
    settings.find(
      (setting) => geographyPairKey(setting.branchA, setting.branchB) === key,
    )?.relation ?? 'MANUAL_ONLY'
  );
}
```

Also reject same-branch pair writes in persistence/UI; `A ↔ A` is never a valid geography setting.

- [ ] **Step 4: Upgrade IndexedDB from v1 to v2 without dropping old stores**

Change `db.ts` to:

```ts
interface OrdersAutoSchema extends DBSchema {
  supplierOverrides: { key: string; value: SupplierOverride; indexes: Record<string, never> };
  settings: { key: string; value: OrderSettings; indexes: Record<string, never> };
  geographyPairs: {
    key: string;
    value: GeographyPairSetting;
    indexes: Record<string, never>;
  };
}

export function db() {
  return openDB<OrdersAutoSchema>('orders-auto', 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('supplierOverrides')) {
        database.createObjectStore('supplierOverrides', { keyPath: 'skuCode' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings');
      }
      if (!database.objectStoreNames.contains('geographyPairs')) {
        database.createObjectStore('geographyPairs');
      }
    },
  });
}
```

- [ ] **Step 5: Implement replace-all geography persistence**

```ts
import type { GeographyPairSetting } from '../domain/types';
import { geographyPairKey } from '../domain/geography';
import { db } from './db';

export async function getGeographySettings(): Promise<GeographyPairSetting[]> {
  return (await db()).getAll('geographyPairs');
}

export async function saveGeographySettings(
  settings: GeographyPairSetting[],
): Promise<void> {
  const database = await db();
  const tx = database.transaction('geographyPairs', 'readwrite');
  await tx.store.clear();
  for (const setting of settings) {
    if (setting.branchA === setting.branchB) continue;
    await tx.store.put(
      setting,
      geographyPairKey(setting.branchA, setting.branchB),
    );
  }
  await tx.done;
}
```

- [ ] **Step 6: Add persistence regression coverage**

In `tests/persistence/persistence.test.ts`, delete/open `orders-auto`, save two relations, reload them, and verify existing supplier/settings stores still work after DB version 2 upgrade.

- [ ] **Step 7: Run focused tests + typecheck**

```bash
npm test -- --run tests/domain/geography.test.ts tests/persistence/persistence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/types.ts src/domain/geography.ts src/persistence tests/domain/geography.test.ts tests/persistence/persistence.test.ts
git commit -m "feat: add rebalance geography contracts"
```

---

### Task 3: Implement deterministic automatic rebalancing proposal

**Files:**
- Create: `src/domain/rebalance.ts`
- Create: `tests/domain/rebalance.test.ts`

**Interfaces:**
- Consumes: `PricedDemandLine[]`, `GeographyPairSetting[]`, `RebalancePriorityMode`.
- Produces:
  - `transferKey(transfer): string`
  - `routeKey(fromBranch, toBranch): string`
  - `buildRebalanceProposal(demand, geography, mode): RebalancePlan`
  - `summarizeRebalancePlan(demand, transfers): RebalanceSummary`

- [ ] **Step 1: Write RED invariant tests**

Build a synthetic SKU with donor `stock=35, MAX=20`, recipient A `stock=6, MAX=16`, recipient B `stock=8, MAX=13`; assert proposal transfers exactly 15 total and leaves donor at 20.

Add explicit tests:

```ts
expect(totalOutgoing('DONOR')).toBeLessThanOrEqual(15);
expect(totalIncoming('A')).toBeLessThanOrEqual(10);
expect(totalIncoming('B')).toBeLessThanOrEqual(5);
expect(plan.transfers.every((x) => x.relation !== 'MANUAL_ONLY')).toBe(true);
```

Add separate fixtures for:
- `NO_NORM` donor/recipient ignored;
- `INVALID_NORM` ignored;
- missing price transfer remains with `purchaseReductionAmount=null`;
- deterministic repeated calls deep-equal;
- network quantity conservation;
- same branch never produces transfer.

Run:

```bash
npm test -- --run tests/domain/rebalance.test.ts
```

Expected: FAIL because `rebalance.ts` does not exist.

- [ ] **Step 2: Implement stable keys and severity/relation ranks**

```ts
export function transferKey(
  transfer: Pick<RebalanceTransfer, 'skuCode' | 'fromBranch' | 'toBranch'>,
): string {
  return `${transfer.skuCode}\0${transfer.fromBranch}\0${transfer.toBranch}`;
}

export function routeKey(fromBranch: string, toBranch: string): string {
  return `${fromBranch}\0${toBranch}`;
}

const statusRank: Record<StockStatus, number> = {
  BELOW_MIN: 4,
  LIGHT_RED: 3,
  ORANGE: 2,
  YELLOW: 1,
  OK: 0,
  NO_NORM: -1,
  INVALID_NORM: -1,
};

const relationRank: Record<RebalanceRelation, number> = {
  PRIORITY: 2,
  ALLOWED: 1,
  MANUAL_ONLY: 0,
};
```

- [ ] **Step 3: Build donors/recipients by SKU in one indexed pass**

Use maps, not nested full-dataset `find()` calls:

```ts
const bySku = new Map<string, PricedDemandLine[]>();
for (const line of demand) {
  const bucket = bySku.get(line.skuCode) ?? [];
  bucket.push(line);
  bySku.set(line.skuCode, bucket);
}
```

For each SKU, donor eligibility is `max != null && max > 0 && min <= max when min exists && stock > max`; recipient eligibility is the same valid-norm predicate plus `deficitQty > 0`.

- [ ] **Step 4: Implement lexicographic candidate comparison**

Candidate shape inside the module:

```ts
interface Candidate {
  donor: PricedDemandLine;
  recipient: PricedDemandLine;
  relation: RebalanceRelation;
  transferableQty: number;
  amount: number | null;
  routeAlreadyUsed: boolean;
}
```

Comparator rules:

```ts
function compareCandidates(a: Candidate, b: Candidate, mode: RebalancePriorityMode) {
  const money = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;
  const criticalCmp = statusRank[b.recipient.status] - statusRank[a.recipient.status];
  const geographyCmp = relationRank[b.relation] - relationRank[a.relation];
  const moneyCmp = money(b.amount) - money(a.amount);

  const primary = mode === 'CRITICALITY_FIRST'
    ? [criticalCmp, moneyCmp, geographyCmp]
    : [geographyCmp, criticalCmp, moneyCmp];

  for (const cmp of primary) if (cmp !== 0) return cmp;
  if (a.routeAlreadyUsed !== b.routeAlreadyUsed) return a.routeAlreadyUsed ? -1 : 1;
  if (a.transferableQty !== b.transferableQty) return b.transferableQty - a.transferableQty;
  return transferKey({
    skuCode: a.recipient.skuCode,
    fromBranch: a.donor.branch,
    toBranch: a.recipient.branch,
  }).localeCompare(
    transferKey({
      skuCode: b.recipient.skuCode,
      fromBranch: b.donor.branch,
      toBranch: b.recipient.branch,
    }),
    'ru-RU',
  );
}
```

Unknown money must sort after known money only within the same higher-priority class.

- [ ] **Step 5: Implement greedy allocation with remaining surplus/gap maps**

The loop must recompute feasible quantities after each transfer and stop when no candidate remains. Each chosen transfer uses full current `min(remainingSurplus, remainingGap)` and updates both maps.

Do not create `MANUAL_ONLY` candidates.

- [ ] **Step 6: Implement exact summary semantics**

`summarizeRebalancePlan()` computes:
- `transferCount = transfers.length`;
- directed route count from `routeKey(from,to)`;
- unique SKU count;
- unique `skuCode + toBranch` recipient-line count;
- total quantity;
- known reduction sum;
- missing-price transfer count;
- residual known purchase amount from original demand minus approved/scenario incoming;
- residual missing-price positive line count.

- [ ] **Step 7: Prove both priority modes**

Add test where `BELOW_MIN` route is `ALLOWED` and a less critical `LIGHT_RED` route is `PRIORITY`:
- `CRITICALITY_FIRST` must allocate scarce donor to `BELOW_MIN` first;
- `GEOGRAPHY_FIRST` must allocate to `PRIORITY` relation first.

- [ ] **Step 8: Run focused suite + typecheck**

```bash
npm test -- --run tests/domain/rebalance.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/domain/rebalance.ts tests/domain/rebalance.test.ts
git commit -m "feat: calculate automatic rebalance proposal"
```

---

### Task 4: Implement Pareto scenarios, draft edits and manual transfers

**Files:**
- Create: `src/domain/rebalanceScenario.ts`
- Create: `tests/domain/rebalanceScenario.test.ts`

**Interfaces:**
- `selectParetoRecipientLines(plan, target): Set<string>`
- `summarizeParetoBySku(plan, target): ParetoSkuSummary`
- `buildRebalanceScenario({ demand, proposal, draft, geography }): RebalancePlan`
- `validateManualTransfer({ demand, currentTransfers, geography, input }): ManualTransferValidation`
- `plansEquivalent(left, right): boolean`

- [ ] **Step 1: Write RED Pareto tests**

For known effects `70, 20, 9, 1` assert:

```ts
expect([...selectParetoRecipientLines(plan, 90)]).toHaveLength(2);
```

The two selected decision-units must be based on `skuCode + toBranch`, not individual donor transfers. Add a case where one recipient is supplied by two donors; both transfers must enter/leave together when that decision-unit is selected.

- [ ] **Step 2: Implement recipient-line Pareto selection**

Aggregate full proposal transfers by:

```ts
const recipientKey = `${transfer.skuCode}\0${transfer.toBranch}`;
```

Ignore `purchaseReductionAmount=null` in percentage denominator but keep unknown-price lines in the plan outside the Pareto money claim. For target 100, include all proposal transfer lines, including unknown-price lines.

For targets 80/90/95, select the minimum number of known-effect recipient units whose cumulative effect reaches the threshold; unknown-price lines are not silently claimed as part of the percentage.

- [ ] **Step 3: Implement analytical `SKU` grouping separately**

```ts
export interface ParetoSkuSummary {
  target: RebalanceParetoTarget;
  selectedSkuCodes: string[];
  knownEffect: number;
  totalKnownEffect: number;
  recipientLineCount: number;
  routeCount: number;
  transferCount: number;
  totalQty: number;
}
```

This function must never feed `buildRebalanceScenario()`; it is display analytics only.

- [ ] **Step 4: Define scenario application order**

Apply draft state deterministically in this order:

```text
full proposal
→ Pareto recipient-line subset
→ excluded transfer keys
→ quantity edits
→ manual transfers
→ validate aggregate donor/recipient constraints
→ summary
```

Quantity edit key is `transferKey()`. If an edit is greater than that transfer's current physical max or negative, return a validation error instead of clamping silently.

- [ ] **Step 5: Implement manual transfer validation against the current scenario**

Validation result:

```ts
export interface ManualTransferValidation {
  valid: boolean;
  maxQty: number;
  relation: RebalanceRelation;
  requiresManualOnlyConfirmation: boolean;
  message: string | null;
}
```

Compute remaining donor surplus after all current outgoing transfers for the same `skuCode/fromBranch`, and remaining recipient gap after all current incoming transfers for the same `skuCode/toBranch`.

`maxQty = min(remainingDonorSurplus, remainingRecipientGap)`.

Reject:
- same branch;
- qty `< 0` or `> maxQty`;
- unknown SKU/branch line;
- invalid/no MAX.

Allow `MANUAL_ONLY` only with `requiresManualOnlyConfirmation=true`; the domain does not mutate geography settings.

- [ ] **Step 6: Make transfer identity singular**

If a manual input targets an existing `skuCode/fromBranch/toBranch`, replace that scenario line quantity and mark `source='MANUAL'` rather than creating a duplicate key. This keeps one line per physical transfer identity and makes edit/reset semantics deterministic.

- [ ] **Step 7: Add scenario tests**

Cover:
- excluded line disappears;
- `qty=0` is a valid removal-equivalent edit;
- invalid qty reports error, no silent clamp;
- manual `MANUAL_ONLY` requires explicit confirmation flag;
- manual transfer never drops donor below MAX;
- manual transfer never overfills recipient;
- analytical `SKU` grouping does not change `buildRebalanceScenario()` output;
- unknown-price line remains physically available.

- [ ] **Step 8: Run tests + typecheck**

```bash
npm test -- --run tests/domain/rebalanceScenario.test.ts tests/domain/rebalance.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/domain/rebalanceScenario.ts tests/domain/rebalanceScenario.test.ts
git commit -m "feat: add rebalance draft and pareto scenarios"
```

---

### Task 5: Add residual purchase projection and route orders through it

**Files:**
- Create: `src/domain/residualDemand.ts`
- Modify: `src/domain/orders.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/app/selectors.ts`
- Create: `tests/domain/residualDemand.test.ts`
- Modify: `tests/domain/orders.test.ts`
- Modify: `tests/ui/useDerivedState.test.tsx`

**Interfaces:**
- `buildResidualPurchaseDemand(demand, approvedPlan): PurchaseDemandLine[]`
- `buildOrderProjection()` consumes `PurchaseDemandLine[]` and uses `residualPurchaseQty` as `calculatedQty`.
- `DerivedState` exposes original `demand`, `rebalanceProposal`, `rebalanceScenario`, `purchaseDemand`, `projection`.

- [ ] **Step 1: Write RED residual tests**

```ts
const residual = buildResidualPurchaseDemand(demand, approvedPlan);
expect(residualLine.deficitQty).toBe(20);            // original remains intact
expect(residualLine.approvedIncomingQty).toBe(12);
expect(residualLine.residualPurchaseQty).toBe(8);
expect(residualLine.residualPurchaseAmount).toBe(800);
```

Also assert null price → null residual amount, no approved plan → residual qty equals original deficit, and approved incoming never mutates source demand objects.

- [ ] **Step 2: Implement residual projection with an indexed incoming map**

```ts
export function buildResidualPurchaseDemand(
  demand: PricedDemandLine[],
  approvedPlan: RebalancePlan | null,
): PurchaseDemandLine[] {
  const incoming = new Map<string, number>();
  for (const transfer of approvedPlan?.transfers ?? []) {
    const key = `${transfer.skuCode}\0${transfer.toBranch}`;
    incoming.set(key, (incoming.get(key) ?? 0) + transfer.qty);
  }

  return demand.map((line) => {
    const approvedIncomingQty = incoming.get(`${line.skuCode}\0${line.branch}`) ?? 0;
    const residualPurchaseQty = Math.max(0, line.deficitQty - approvedIncomingQty);
    return {
      ...line,
      approvedIncomingQty,
      residualPurchaseQty,
      residualPurchaseAmount:
        line.unitPrice == null ? null : residualPurchaseQty * line.unitPrice,
    };
  });
}
```

- [ ] **Step 3: Change `buildOrderProjection()` to purchase semantics**

Change input type from `PricedDemandLine[]` to `PurchaseDemandLine[]` and replace business quantity checks:

```ts
if (
  line.residualPurchaseQty <= 0 ||
  line.status === 'INVALID_NORM' ||
  line.status === 'NO_NORM'
) continue;

const calculatedQty = line.residualPurchaseQty;
const orderQty = editBySkuBranch.get(key) ?? calculatedQty;
```

Set `OrderLine.calculatedQty = calculatedQty`; warning compares `orderQty > calculatedQty`.

Do not overwrite `line.deficitQty`.

- [ ] **Step 4: Extend `DerivedState` in one central selector**

```ts
export interface DerivedState {
  resolutions: SupplierResolution[];
  demand: PricedDemandLine[];
  rebalanceProposal: RebalancePlan;
  rebalanceScenario: RebalancePlan;
  purchaseDemand: PurchaseDemandLine[];
  projection: WorkflowOrderProjection;
}
```

Derivation order:

```ts
const demand = priceDemand(...);
const rebalanceProposal = buildRebalanceProposal(
  demand,
  state.geographySettings,
  state.rebalanceMode,
);
const rebalanceScenario = buildRebalanceScenario({
  demand,
  proposal: rebalanceProposal,
  draft: state.rebalanceDraft,
  geography: state.geographySettings,
});
const purchaseDemand = buildResidualPurchaseDemand(
  demand,
  state.approvedRebalancePlan,
);
const baseProjection = buildOrderProjection(
  purchaseDemand,
  resolutions,
  state.edits,
  state.settings,
);
```

Before imports, return empty plans with the current mode and empty summaries.

- [ ] **Step 5: Update order/domain tests**

Add one order regression proving a 12-unit approved incoming transfer changes `calculatedQty` from 20 to 8, while the demand line still reports 20.

- [ ] **Step 6: Run focused tests + typecheck**

```bash
npm test -- --run tests/domain/residualDemand.test.ts tests/domain/orders.test.ts tests/ui/useDerivedState.test.tsx
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/domain/residualDemand.ts src/domain/orders.ts src/domain/types.ts src/app/selectors.ts tests/domain/residualDemand.test.ts tests/domain/orders.test.ts tests/ui/useDerivedState.test.tsx
git commit -m "feat: apply approved rebalance to purchase demand"
```

---

### Task 6: Add session lifecycle, approval invalidation and shared app dialog

**Files:**
- Modify: `src/app/appStore.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/features/import/ImportPage.tsx`
- Create: `src/domain/rebalanceWorkflow.ts`
- Create: `src/components/AppDialog.tsx`
- Create: `tests/domain/rebalanceWorkflow.test.ts`
- Create: `tests/ui/appDialog.test.tsx`
- Modify: `tests/ui/renderWithStore.tsx`
- Modify: `tests/ui/importReviewReset.test.tsx`

**Interfaces:**
- App state owns persisted geography + session mode/draft/approved snapshot.
- `applyRebalanceApproval()` returns the exact workflow state patch needed to commit a plan and invalidate affected order metadata.
- `AppDialog` is the canonical modal owner for this feature and replaces the existing `window.confirm()` reset flow while `App.tsx` is touched.

- [ ] **Step 1: Extend `AppState` and defaults**

Add:

```ts
geographySettings: GeographyPairSetting[];
rebalanceMode: RebalancePriorityMode;
rebalanceDraft: RebalanceDraftState;
approvedRebalancePlan: RebalancePlan | null;
```

Default session state:

```ts
rebalanceMode: 'CRITICALITY_FIRST',
rebalanceDraft: {
  paretoTarget: 90,
  excludedTransferKeys: [],
  qtyEdits: [],
  manualTransfers: [],
},
approvedRebalancePlan: null,
```

`baseState()` test helper must include the same defaults.

- [ ] **Step 2: Load geography settings during App initialization**

Change App startup `Promise.all` to load supplier overrides, order settings and geography settings. If geography persistence fails, continue with `[]` and show the existing local-storage failure style toast.

- [ ] **Step 3: Define approval impact from changed recipient purchase keys**

In `rebalanceWorkflow.ts`:

```ts
export function incomingByRecipient(plan: RebalancePlan | null): Map<string, number> {
  const result = new Map<string, number>();
  for (const transfer of plan?.transfers ?? []) {
    const key = `${transfer.skuCode}\0${transfer.toBranch}`;
    result.set(key, (result.get(key) ?? 0) + transfer.qty);
  }
  return result;
}
```

Compare previous vs next incoming maps to produce affected `skuCode\0branch` keys.

`applyRebalanceApproval()` must:
- remove only `OrderQtyEdit` records whose `skuCode+branch` is affected;
- remove review/export markers only for current orders containing at least one affected line;
- set `approvedRebalancePlan = nextPlan`;
- keep unrelated edits/reviews/exports unchanged.

- [ ] **Step 4: Write RED invalidation tests**

Create two orders in different branches; approve a plan affecting only one branch. Assert only that branch's edit/review/export markers are removed.

- [ ] **Step 5: Build the shared app-owned dialog on native `<dialog>`**

Component contract:

```tsx
<AppDialog
  open={open}
  title="Пересчитать заказы?"
  description="..."
  onClose={...}
  actions={...}
>
  ...
</AppDialog>
```

Implementation requirements:
- call `dialog.showModal()` when `open` becomes true;
- call `.close()` when false;
- intercept native `cancel` and delegate to `onClose`;
- render real heading/description IDs referenced by `aria-labelledby`/`aria-describedby`;
- restore focus to the opening trigger by native dialog behavior plus explicit trigger ref test;
- no `alert/confirm/prompt`.

Minimal effect:

```tsx
useEffect(() => {
  const dialog = ref.current;
  if (!dialog) return;
  if (open && !dialog.open) dialog.showModal();
  if (!open && dialog.open) dialog.close();
}, [open]);
```

- [ ] **Step 6: Replace existing `window.confirm()` in `App.tsx`**

When user clicks `Загрузить новые отчёты` and there are manual order edits, open `AppDialog` with actions `Остаться` and `Загрузить новые отчёты`. This prevents the new premium UI audit from retaining a known browser-native confirm in the shell being modified.

- [ ] **Step 7: Reset rebalance session state on input-report replacement**

On successful replacement of either Min-Max or supplier report, clear:

```ts
approvedRebalancePlan: null,
rebalanceDraft: createDefaultRebalanceDraft(),
reviewedOrderIds: [],
exportedOrderIds: [],
```

Keep `geographySettings` unchanged. This treats the pair of imported reports as one calculation snapshot and prevents stale price/effect metadata after supplier-report replacement.

- [ ] **Step 8: Run focused tests**

```bash
npm test -- --run tests/domain/rebalanceWorkflow.test.ts tests/ui/appDialog.test.tsx tests/ui/importReviewReset.test.tsx
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/app src/features/import/ImportPage.tsx src/domain/rebalanceWorkflow.ts src/components/AppDialog.tsx tests/domain/rebalanceWorkflow.test.ts tests/ui/appDialog.test.tsx tests/ui/renderWithStore.tsx tests/ui/importReviewReset.test.tsx
git commit -m "feat: add rebalance approval lifecycle"
```

---

### Task 7: Add the Rebalancing workspace shell, controls, KPI semantics and presentation filters

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/features/rebalance/RebalancePage.tsx`
- Create: `src/features/rebalance/RebalanceKpis.tsx`
- Create: `src/features/rebalance/RebalanceFilters.tsx`
- Create: `src/features/rebalance/rebalanceView.ts`
- Modify: `src/styles/app.css`
- Create: `tests/ui/rebalancePage.test.tsx`

**Interfaces:**
- `RebalancePage` reads only derived domain projections + AppState controls.
- Filters are presentation-only; they never call allocation functions or mutate the plan.
- Default mode `Критичные`, default Pareto target `90%`, analytical grouping default `Строки закупки`.

- [ ] **Step 1: Write RED navigation/workspace test**

Render imported `App`, click `Ребалансировка`, assert heading and these labels:

```ts
expect(screen.getByRole('heading', { name: 'Ребалансировка' })).toBeInTheDocument();
expect(screen.getByText('Закупка до')).toBeInTheDocument();
expect(screen.getByText('Сокращение закупки')).toBeInTheDocument();
expect(screen.getByText('Остаточная закупка')).toBeInTheDocument();
```

- [ ] **Step 2: Insert top-level navigation in workflow order**

In `App.tsx`, add a button after branch navigation and before `Поставщики`:

```tsx
<button
  className={state.page === 'rebalance' ? 'active' : ''}
  onClick={() => set({ page: 'rebalance' })}
>
  Ребалансировка
</button>
```

Route content to `<RebalancePage />` before suppliers/orders fallthrough.

- [ ] **Step 3: Implement page state without a second business store**

`RebalancePage` uses:

```ts
const derived = derive(state);
const proposal = derived.rebalanceProposal;
const scenario = derived.rebalanceScenario;
const approved = state.approvedRebalancePlan;
```

Local presentation state only:

```ts
const [grouping, setGrouping] = useState<'RECIPIENT_LINE' | 'SKU'>('RECIPIENT_LINE');
const [filters, setFilters] = useState<RebalanceFilters>(emptyRebalanceFilters);
const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(null);
```

- [ ] **Step 4: Build exact KPI layer**

`RebalanceKpis` shows only:

```text
Закупка до
Сокращение закупки
Остаточная закупка
```

Below it show workload:

```text
N маршрутов · M SKU-линий · Q шт.
```

If any positive demand/transfer has missing price, append explicit `K строк без цены`; never present known amount as complete.

- [ ] **Step 5: Implement mode and Pareto controls**

Mode buttons update `state.rebalanceMode`.

Pareto buttons update only:

```ts
set({
  rebalanceDraft: { ...state.rebalanceDraft, paretoTarget: 90 },
});
```

Grouping toggle changes only local analytical presentation; no state used by `derive()`.

- [ ] **Step 6: Implement presentation filter contract**

```ts
export interface RebalanceFilters {
  query: string;
  amountFrom: string;
  amountTo: string;
  donor: string;
  recipient: string;
  relation: 'ALL' | RebalanceRelation;
  recipientStatus: 'ALL' | StockStatus;
  fullGapOnly: boolean;
}
```

`filterScenarioTransfers()` receives an already-built scenario and returns visible transfer keys/routes. It must not call `buildRebalanceProposal()` or change quantities.

Search matches 1C code, article and name. Non-empty search has an explicit `Очистить поиск` button.

- [ ] **Step 7: Add state labels**

Use deterministic status:

```text
no approved plan                -> Не утверждено
approved && plansEquivalent     -> Утверждено
approved && !plansEquivalent    -> Есть новый черновик
```

`Автопредложение` labels the full-potential source, not the approval state.

- [ ] **Step 8: Add core CSS using existing tokens only**

Create `.rebalance-*` classes using `var(--blue)`, `var(--line)`, `var(--surface)`, `var(--muted)`, `var(--warning)`, `var(--danger)`. Do not add gradients, glass, glow or a new palette.

- [ ] **Step 9: Run UI test + typecheck**

```bash
npm test -- --run tests/ui/rebalancePage.test.tsx
npm run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add src/app/App.tsx src/features/rebalance src/styles/app.css tests/ui/rebalancePage.test.tsx
git commit -m "feat: add rebalancing workspace shell"
```

---

### Task 8: Build deterministic flow-map view model and accessible route list

**Files:**
- Create: `src/features/rebalance/flowLayout.ts`
- Create: `src/features/rebalance/RebalanceFlowMap.tsx`
- Create: `src/features/rebalance/RebalanceRouteList.tsx`
- Modify: `src/features/rebalance/rebalanceView.ts`
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/styles/app.css`
- Create: `tests/ui/rebalanceFlowMap.test.tsx`
- Create: `tests/domain/rebalanceView.test.ts`

**Interfaces:**
- `buildRouteSummaries(transfers): RebalanceRouteSummary[]`
- `buildFlowLayout(routeSummaries): FlowLayout`
- Map and route list consume the same route summaries and selection callback.

- [ ] **Step 1: Define route aggregation once**

```ts
export interface RebalanceRouteSummary {
  key: string;
  fromBranch: string;
  toBranch: string;
  relation: RebalanceRelation;
  transfers: RebalanceTransfer[];
  skuCount: number;
  totalQty: number;
  knownReductionAmount: number;
  missingPriceCount: number;
}
```

Aggregate by directed `routeKey(fromBranch,toBranch)`. Relation is identical for every line on one pair because geography is symmetric; manual-only route remains explicitly `MANUAL_ONLY`.

- [ ] **Step 2: Write view-model tests**

Assert multiple SKU lines on one route produce one route card; reverse direction is a separate directed route; filters hide view lines without changing the source scenario summary.

- [ ] **Step 3: Implement topological node roles**

For every visible branch:

```ts
role = outgoing > 0 && incoming > 0 ? 'MIXED'
     : outgoing > 0 ? 'DONOR'
     : 'RECIPIENT';
```

Sort within each role by known financial effect descending, then branch name. Coordinates use a fixed logical width 1000:

```ts
DONOR x = 90
MIXED x = 500
RECIPIENT x = 910
```

Vertical gap 96 px; map height is `max(roleColumnLength) * 96 + 80`, minimum 420 px. This avoids a graph-layout dependency and is deterministic.

- [ ] **Step 4: Render visual connectors in SVG, interactions in semantic HTML**

`RebalanceFlowMap` renders:
- absolutely positioned `<button>` node cards for branches;
- an `aria-hidden="true"` SVG layer for curved connector paths;
- absolutely positioned route-summary `<button>` controls near connector midpoints.

The route button contains text such as:

```text
2 SKU · 30 шт · −71 400 ₽
Приоритетно
```

For missing prices:

```text
−71 400 ₽ + 1 строка без цены
```

Do not make SVG paths themselves the only click target.

- [ ] **Step 5: Encode relation with shape + text, not color only**

- `PRIORITY`: solid connector + label `Приоритетно`.
- `ALLOWED`: dashed connector + label `Допустимо`.
- `MANUAL_ONLY`: warning marker + label `Только вручную`.

No animated flowing particles.

- [ ] **Step 6: Build route-list fallback from the same data**

`RebalanceRouteList` is always reachable via a visible `Список маршрутов` disclosure/tab and contains real buttons with the same summary, relation and `onSelectRoute(key)` behavior.

Test keyboard activation of a route-list button and assert it opens the same selected-route state as map click.

- [ ] **Step 7: Branch focus interaction**

Node click sets local `focusedBranch`; connected routes remain full opacity, unrelated routes receive `.is-muted`. Provide `Показать всю сеть` control to clear focus. This changes presentation only.

- [ ] **Step 8: Run focused tests**

```bash
npm test -- --run tests/domain/rebalanceView.test.ts tests/ui/rebalanceFlowMap.test.tsx tests/ui/rebalancePage.test.tsx
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/features/rebalance src/styles/app.css tests/domain/rebalanceView.test.ts tests/ui/rebalanceFlowMap.test.tsx
git commit -m "feat: visualize rebalance flows"
```

---

### Task 9: Add route inspector and direct quantity editing

**Files:**
- Create: `src/features/rebalance/RouteInspector.tsx`
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/styles/app.css`
- Create: `tests/ui/rebalanceInspector.test.tsx`

**Interfaces:**
- Inspector receives selected `RebalanceRouteSummary`, original demand and current draft state.
- Quantity edits write `RebalanceQtyEdit[]`; domain scenario builder validates them.

- [ ] **Step 1: Write RED inspector test**

Select a route and assert columns/labels:

```text
Код
Артикул
Номенклатура
До MAX получателю
Доступно у донора
Переместить
Сокращение закупки
```

Edit a quantity from 10 to 6 and assert top KPI reduction and workload update immediately while orders remain unchanged before approval.

- [ ] **Step 2: Render route header**

Show:

```text
Егорьевск → Рязань
Приоритетно
2 SKU · 30 шт · −71 400 ₽
```

- [ ] **Step 3: Implement numeric editor without native validation bubbles**

Use `type="number"`, `min=0`, `step="any"`, but validate in React/domain. On invalid entry show an inline error tied with `aria-describedby`; do not call `reportValidity()`.

Update state by replacing/adding the exact `transferKey` edit:

```ts
const nextQtyEdits = state.rebalanceDraft.qtyEdits.filter(
  (edit) => edit.transferKey !== key,
);
nextQtyEdits.push({ transferKey: key, qty });
```

If qty equals current recommendation, remove the edit instead of keeping a redundant override.

- [ ] **Step 4: Show before/after safety proof per line**

For a valid edit display:

```text
Донор после перемещения: 20 / MAX 20 ✓
Получатель после перемещения: 16 / MAX 16 ✓
```

Calculate from original stock plus all current scenario transfers for the same SKU/branch, not just the edited line in isolation.

- [ ] **Step 5: Add line/route actions**

- `Убрать из сценария` adds transfer key to `excludedTransferKeys`.
- `Вернуть рекомендацию` removes qty edit/exclusion for that key.
- `Убрать маршрут` adds every route transfer key to exclusions.

All are buttons with visible focus states.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- --run tests/ui/rebalanceInspector.test.tsx tests/domain/rebalanceScenario.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/features/rebalance/RouteInspector.tsx src/features/rebalance/RebalancePage.tsx src/styles/app.css tests/ui/rebalanceInspector.test.tsx
git commit -m "feat: edit rebalance route quantities"
```

---

### Task 10: Add explicit manual transfer builder, including MANUAL_ONLY warning path

**Files:**
- Create: `src/features/rebalance/ManualTransferBuilder.tsx`
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/styles/app.css`
- Create: `tests/ui/manualTransferBuilder.test.tsx`

**Interfaces:**
- Uses `validateManualTransfer()` from Task 4.
- Native `<select>` is intentionally accepted as canonical here because ORDERS_AUTO targets current Chrome/Edge and does not require authored popup geometry; style the closed control with existing `.input` language.

- [ ] **Step 1: Write RED manual-path tests**

Cover:
- SKU selector contains only valid-MAX SKU with donor surplus and recipient gap;
- donor options have remaining surplus;
- recipient cannot equal donor;
- quantity over max shows error;
- `MANUAL_ONLY` produces explicit warning and requires a second `Добавить вручную` action;
- adding it does not mutate geography settings.

- [ ] **Step 2: Build a four-field `noValidate` form**

```tsx
<form noValidate onSubmit={handleSubmit}>
  <label>SKU<select ... /></label>
  <label>Донор<select ... /></label>
  <label>Получатель<select ... /></label>
  <label>Количество<input type="number" min="0" step="any" ... /></label>
  <Button type="submit">Добавить перемещение</Button>
</form>
```

Each label is real and every dependent select resets when its upstream choice becomes invalid.

- [ ] **Step 3: Show physical availability next to options**

Donor option text: `Егорьевск — доступно 15`.
Recipient option text: `Рязань — gap 10`.

- [ ] **Step 4: Implement `MANUAL_ONLY` confirmation without modal fatigue**

When validation returns `requiresManualOnlyConfirmation=true`, do not add immediately. Render persistent inline warning:

```text
Эта связь исключена из автоматической ребалансировки.
Добавить конкретное перемещение вручную?
[Отмена] [Добавить вручную]
```

Only the second button appends the manual input to `rebalanceDraft.manualTransfers`.

- [ ] **Step 5: Verify existing-line behavior**

If the same `sku/from/to` already exists in scenario, submitting manual input replaces that transfer quantity/source per Task 4; UI copy says `Количество существующего перемещения будет изменено`.

- [ ] **Step 6: Run tests + typecheck**

```bash
npm test -- --run tests/ui/manualTransferBuilder.test.tsx tests/domain/rebalanceScenario.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/features/rebalance/ManualTransferBuilder.tsx src/features/rebalance/RebalancePage.tsx src/styles/app.css tests/ui/manualTransferBuilder.test.tsx
git commit -m "feat: add manual rebalance transfers"
```

---

### Task 11: Add symmetric geography settings matrix with bulk editing and persistence

**Files:**
- Create: `src/features/rebalance/GeographySettingsDialog.tsx`
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/styles/app.css`
- Create: `tests/ui/geographySettings.test.tsx`

**Interfaces:**
- Dialog edits a local draft `GeographyPairSetting[]` and only writes to AppState/persistence on `Сохранить`.
- Matrix mirrors one unordered pair in two visual cells.
- Saving changes rebuilds proposal/scenario through normal `derive()` inputs but does not replace approved plan.

- [ ] **Step 1: Write RED symmetric matrix test**

Open settings with branches `A, B, C`, change `A ↔ B` from `MANUAL_ONLY` to `PRIORITY`, assert both visual cells expose accessible name `A ↔ B: Приоритетно` and `B ↔ A: Приоритетно`, but the draft data contains one pair setting.

- [ ] **Step 2: Use `AppDialog` as a large settings surface**

Dialog title: `Настройка географии перемещений`.
Description: `Связь симметрична и действует одинаково в обе стороны.`

The body owns scrolling; title/actions remain visible. Background workspace is inert while open.

- [ ] **Step 3: Render full mirrored matrix but write one unordered pair**

Diagonal cells render `—` and are non-interactive.

Each editable cell is a real button with text/accessible name; cycling order:

```text
Только вручную → Допустимо → Приоритетно → Только вручную
```

The mirrored cell reads the same underlying relation immediately.

- [ ] **Step 4: Add pair selection and bulk actions**

Selection uses checkboxes for unordered pairs, not duplicate mirrored cells. Show exact `Выбрано пар: N` and actions:

```text
Сделать приоритетными
Сделать допустимыми
Только вручную
```

Bulk action updates every selected pair in local draft.

- [ ] **Step 5: Implement Save/Cancel/dirty behavior**

`Сохранить`:

```ts
await saveGeographySettings(draftSettings);
set({ geographySettings: draftSettings, toast: 'Настройки географии сохранены.' });
```

Do not change `approvedRebalancePlan`.

If closing while dirty, prevent immediate close and show within the same dialog:

```text
Есть несохранённые изменения.
[Продолжить редактирование] [Отменить изменения]
```

Avoid a nested modal.

- [ ] **Step 6: Add persistence failure recovery**

On save failure, keep the dialog and draft open, show an inline `role="alert"` message `Не удалось сохранить настройки географии. Повторите попытку.`; do not discard edits.

- [ ] **Step 7: Run focused tests**

```bash
npm test -- --run tests/ui/geographySettings.test.tsx tests/persistence/persistence.test.ts tests/domain/geography.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/features/rebalance/GeographySettingsDialog.tsx src/features/rebalance/RebalancePage.tsx src/styles/app.css tests/ui/geographySettings.test.tsx
git commit -m "feat: configure rebalance geography"
```

---

### Task 12: Implement approval UX and downstream transparency

**Files:**
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/features/demand/DemandPage.tsx`
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify: `src/features/suppliers/SuppliersPage.tsx`
- Modify: `src/styles/app.css`
- Create: `tests/ui/rebalanceApproval.test.tsx`
- Modify: `tests/ui/demandPage.test.tsx`
- Modify: `tests/ui/ordersPage.test.tsx`
- Modify: `tests/ui/suppliersPage.test.tsx`

**Interfaces:**
- Approval commits current `derived.rebalanceScenario` using Task 6 invalidation helper.
- Demand continues to show original gap; Orders/Suppliers use residual projection.

- [ ] **Step 1: Write RED end-to-end component test for approval**

Synthetic state:
- recipient gap 20;
- scenario incoming 12;
- current order calculated 20 before approval;
- one unrelated manual order edit in another branch.

Click `Утвердить перемещения`; after commit assert recipient order calculated quantity becomes 8 and unrelated edit remains.

- [ ] **Step 2: Add approval action with consequences summary**

Primary button: `Утвердить перемещения`.

Before approval show:

```text
После утверждения:
− закупка сократится на X ₽
− останется заказать Y ₽
− N маршрутов / M SKU-линий / Q шт.
```

If affected manual order edits exist, open `AppDialog`:

```text
Пересчитать заказы?
У N затронутых строк есть ручные количества. Они будут сброшены,
потому что изменится расчётная потребность.
[Отмена] [Утвердить и пересчитать]
```

If no affected edits, approval can commit without a confirmation dialog.

- [ ] **Step 3: Commit plan through `applyRebalanceApproval()`**

Set the returned state patch plus toast:

```text
Перемещения утверждены. Закупочная потребность и заказы пересчитаны.
```

- [ ] **Step 4: Add original-vs-residual transparency to Demand**

When approved incoming > 0 for a row, retain existing `Нужно сюда` = original `deficitQty` and add/show `Осталось заказать` = `residualPurchaseQty` in the branch view/detail. Do not relabel the original physical gap as residual.

- [ ] **Step 5: Add Orders context banner**

When `approvedRebalancePlan != null`, show a compact info banner above the order matrix:

```text
В заказах учтена утверждённая ребалансировка:
−X ₽ закупки · N маршрутов.
[Открыть ребалансировку]
```

Button sets `page: 'rebalance'`.

- [ ] **Step 6: Add Suppliers context without duplicating calculations**

Supplier totals already derive from residual orders. Add only a short info line/banner that approved rebalance is included; do not reimplement supplier math in the page.

- [ ] **Step 7: Preserve approved baseline when draft changes**

Changing priority mode, Pareto target, geography or draft quantities must update proposal/scenario status to `Есть новый черновик` while `purchaseDemand` and orders continue using the prior `approvedRebalancePlan` until the next approval.

Add a regression test for this exact behavior.

- [ ] **Step 8: Run focused UI suites**

```bash
npm test -- --run tests/ui/rebalanceApproval.test.tsx tests/ui/demandPage.test.tsx tests/ui/ordersPage.test.tsx tests/ui/suppliersPage.test.tsx
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/features/rebalance/RebalancePage.tsx src/features/demand/DemandPage.tsx src/features/orders/OrdersPage.tsx src/features/suppliers/SuppliersPage.tsx src/styles/app.css tests/ui
git commit -m "feat: approve rebalance into purchase orders"
```

---

### Task 13: Cover empty/error states, accessibility, layout stability and offline E2E

**Files:**
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/features/rebalance/RebalanceFlowMap.tsx`
- Modify: `src/features/rebalance/RebalanceRouteList.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/e2e/offline.spec.ts`
- Create: `tests/ui/rebalanceStates.test.tsx`
- Modify: `.github/workflows/verify.yml` only if the existing test command needs no automatic discovery (normally no change expected)

**Interfaces:**
- Production acceptance remains the existing offline `dist/ORDERS_AUTO/index.html` contract.
- Rebalance has explicit empty/no-route/missing-price/invalid-norm states and works by keyboard.

- [ ] **Step 1: Add explicit state tests before implementation**

Test exact messages:

```text
В сети нет остатков выше MAX, доступных для автоматической ребалансировки.
```

```text
Есть излишек, но автоматические маршруты не настроены.
```

Also test:
- missing price retains quantity transfers and shows `Эффект неизвестен`/unknown count;
- `NO_NORM`/`INVALID_NORM` diagnostic count explains exclusion;
- `MANUAL_ONLY` never appears in auto proposal.

- [ ] **Step 2: Add geography-blocked empty-state action**

If physical donor surplus + recipient gaps exist but all pair relations are `MANUAL_ONLY`, show `Открыть настройку географии` and open the settings dialog.

- [ ] **Step 3: Verify keyboard contracts in component tests**

Cover:
- Tab reaches mode, Pareto, map route buttons/list route buttons, inspector editors and approval;
- Enter/Space activates route buttons;
- Escape closes `AppDialog` when cancellation is allowed;
- focus-visible class/outline is not hidden by sticky inspector/settings headers.

- [ ] **Step 4: Add reduced-motion and scrollbar CSS**

Do not animate continuous paths. Any route/node transition must be behind:

```css
@media (prefers-reduced-motion: reduce) {
  .rebalance-flow-map *,
  .rebalance-route-button {
    transition: none !important;
    animation: none !important;
  }
}
```

Ensure new overflow regions inherit or extend the app scrollbar baseline; do not hide scrollbars.

- [ ] **Step 5: Add real `file://` E2E workflow**

Extend `tests/e2e/offline.spec.ts` synthetic/local packaged flow to assert:

```text
open file:// production app
→ import synthetic reports using existing E2E fixture path
→ open Ребалансировка
→ configure one pair as Приоритетно
→ choose 90%
→ select a route
→ change one transfer qty
→ approve
→ open Заказы
→ verify residual calculated quantity
```

Also assert no page/console errors and no HTTP/HTTPS runtime requests, preserving current package smoke checks.

- [ ] **Step 6: Run Frontend Design Premium static checks locally if skill tooling is available**

Run from the installed skill directory or equivalent:

```bash
python scripts/audit_project.py <repo-root> --mode strict --no-write
```

Resolve findings in touched UI. Specifically grep:

```bash
rg -n "window\.(alert|confirm|prompt)|onClick=\{.*div|TODO|TBD" src
```

Expected: no browser-native dialogs in touched shell/workflow and no plan placeholders.

- [ ] **Step 7: Run full engineering gates**

```bash
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

Expected:
- all TypeScript/tests pass;
- offline package validation passes;
- `file://` Chrome smoke passes;
- no runtime network dependency added.

- [ ] **Step 8: Manually inspect the production UI at two widths**

Open `dist/ORDERS_AUTO/index.html` via `file://` in Chrome/Edge and inspect:
- desktop around 1440 px: map, KPI, inspector, settings matrix;
- narrow desktop around 1024 px / 200% zoom: route list remains operable, map may horizontally scroll but actions are not clipped;
- keyboard focus and `prefers-reduced-motion` behavior.

Record only defects/verification result; do not introduce a responsive card redesign unrelated to this feature.

- [ ] **Step 9: Final documentation drift check**

Compare implemented types/labels with:
- `DESIGN.md`;
- approved design spec;
- authoritative docs updated in Task 1.

Run:

```bash
git diff --check
rg -n "Приоритетно|Допустимо|Только вручную|Сокращение закупки|Остаточная закупка" src docs
```

Fix terminology drift before completion.

- [ ] **Step 10: Commit final verification changes**

```bash
git add src tests docs .github

git commit -m "test: verify offline rebalance workflow"
```

---

## Execution order and review gates

Implement Tasks 1–13 strictly in order because later interfaces depend on earlier contracts.

Recommended review boundaries:

```text
Gate A — Tasks 1–2: authoritative contracts + persistence schema
Gate B — Tasks 3–5: pure domain engine + residual order integration
Gate C — Task 6: lifecycle / invalidation / dialog owner
Gate D — Tasks 7–11: user-facing rebalancing workspace
Gate E — Task 12: approval + downstream integration
Gate F — Task 13: full verification / accessibility / file:// acceptance
```

At each gate:

```bash
npm run typecheck
npm test -- --run
```

At Gate F additionally:

```bash
npm run build
npm run test:e2e
```

## Definition of Done

The feature is complete only when all are true:

1. Auto proposal never takes donor below MAX and never uses `MANUAL_ONLY`.
2. Both priority modes produce deterministic, tested plans.
3. Pareto 80/90/95/100 works on `SKU × recipient`; `SKU` grouping remains analytics-only.
4. Manual transfers obey physical MAX invariants and explicit manual-only warning semantics.
5. Geography matrix is symmetric, persists between sessions/imports and defaults unknown pairs to `MANUAL_ONLY`.
6. Proposal/draft do not change orders; only approved plan creates residual purchase quantities.
7. Original `deficitQty` remains intact and visible as physical gap.
8. Approval resets only affected manual order edits/review/export state.
9. A new input-report snapshot clears draft/approved rebalance state but preserves geography.
10. Rebalance workspace clearly shows `Закупка до / Сокращение закупки / Остаточная закупка` and `маршруты / SKU-линии / единицы`.
11. Flow-map and route-list expose the same actionable routes; all core actions work without drag and by keyboard.
12. Downstream Demand/Suppliers/Orders explain why purchase totals differ from original demand after approval.
13. Empty/no-route/missing-price/invalid-norm states are explicit and actionable.
14. No new external graph/map/runtime service or network dependency exists.
15. `npm run typecheck`, `npm test -- --run`, `npm run build`, `npm run test:e2e` all pass.
16. Production `dist/ORDERS_AUTO/index.html` runs by double-click / `file://` in current Chrome/Edge and the existing rolling Release packaging contract remains intact.
