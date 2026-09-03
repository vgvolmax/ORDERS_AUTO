# Rebalancing Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в ORDERS_AUTO отдельный модуль «Ребалансировка», который предлагает и редактирует внутренние перемещения только из остатка сверх MAX, показывает финансовый эффект и трудозатраты, позволяет настроить симметричную географию связок, а после явного утверждения уменьшает закупочную потребность и downstream-заказы.

**Architecture:** Исходная `PricedDemandLine[]` остаётся неизменяемой физической потребностью. Новый pure-domain слой строит `auto proposal → draft scenario → approved plan`; отдельная residual purchase projection уменьшает закупку только на approved incoming transfers и уже она передаётся в `buildOrderProjection()`. Geography settings сохраняются в IndexedDB, proposal/draft/approved plan живут только в текущем import snapshot/session. UI получает отдельный top-level workspace с flow-map, доступным route-list fallback, inspector, manual transfer builder и geography matrix.

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
- Новая загрузка входного snapshot сбрасывает proposal/draft/approved session state, но сохраняет geography settings.
- Runtime остаётся полностью offline/static и запускается через `file://`; никаких runtime HTTP/HTTPS, CDN, telemetry, backend или solver API.
- UI русский, desktop-first от 1280 px, WCAG 2.2 AA baseline, цвет никогда не является единственным сигналом.
- Flow-map обязан иметь keyboard-accessible route-list fallback; drag, если появится, только как progressive enhancement.
- Следовать `DESIGN.md`; flow-map — единственный выразительный signature-element, остальные control/table surfaces остаются в существующем языке ORDERS_AUTO.
- Не использовать `window.alert`, `window.confirm`, `window.prompt` в новом workflow. Общий dialog owner — app-owned styled native `<dialog>`.
- Для каждого доменного правила: RED test → minimal implementation → GREEN → commit.
- После каждого законченного task минимум: `npm run typecheck` и focused tests. Перед merge: `npm run verify` и `npm run test:e2e`.

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

- [ ] **Step 1: Update `SPEC.md` with the exact business chain**

Insert after demand calculation:

```md
## Ребалансировка перед закупкой

Потребность до MAX сначала проходит через модуль внутренних перемещений.
Донор может отдавать только `max(0, stock - MAX)` и после перемещения обязан
оставаться не ниже MAX. Получатель может получить не больше gap до MAX.

Связи подразделений симметричны:
`Приоритетно / Допустимо / Только вручную`.
`Только вручную` исключено из автоматического proposal.

Только утверждённый plan уменьшает внешнюю закупку:

`residualPurchaseQty = max(0, deficitQty - approvedIncomingQty)`

`NO_NORM` и `INVALID_NORM` не участвуют в ребалансировке. Proposal и draft не
влияют на заказы. Geography settings сохраняются локально; plan привязан к
текущему import snapshot.
```

- [ ] **Step 2: Add exact contracts to `DATA_CONTRACTS.md`**

Document verbatim the types introduced in Task 2: `RebalanceRelation`, `RebalancePriorityMode`, `RebalanceTransferSource`, `RebalanceParetoTarget`, `GeographyPairSetting`, `RebalanceTransfer`, `RebalanceSummary`, `RebalancePlan`, `RebalanceQtyEdit`, `ManualRebalanceTransferInput`, `RebalanceDraftState`, `RebalanceScenarioIssue`, `RebalanceScenarioResult`, `PurchaseDemandLine`. State that geography pair identity is an unordered normalized branch pair.

- [ ] **Step 3: Add the derived projection graph to `DERIVED_PROJECTIONS.md`**

```text
PricedDemandLine[]
  ├─> RebalanceProposal
  │     └─> RebalanceScenarioResult.plan
  │           └─(approve)─> ApprovedRebalancePlan
  └─> buildResidualPurchaseDemand(approvedPlan)
          └─> PurchaseDemandLine[]
                  └─> buildOrderProjection()
```

Add the invariant: `deficitQty` remains original physical gap; `residualPurchaseQty` is the downstream purchase quantity.

- [ ] **Step 4: Update architecture ownership**

Add the five new domain files, `geographyPairs` persistence and `features/rebalance/` boundary to `ARCHITECTURE.md`. Keep the current offline/static `file://` deployment contract unchanged.

- [ ] **Step 5: Update `UX_AND_EXPORT.md` with observable behavior**

Add one section with this exact vocabulary and hierarchy:

```md
Ребалансировка располагается после demand context и до `Поставщики`/`Заказы`.
Основной экран: режим `Критичные / По географии`, Pareto `80/90/95/100`, KPI
`Закупка до / Сокращение закупки / Остаточная закупка`, flow-map, доступный
`Список маршрутов`, route inspector, manual transfer builder и действие
`Утвердить перемещения`.

Geography matrix симметрична и использует `Приоритетно / Допустимо /
Только вручную`. `Только вручную` не попадает в автоматический proposal.
```

Also document approval state labels: `Не утверждено`, `Утверждено`, `Есть новый черновик`.

- [ ] **Step 6: Update `ACCEPTANCE_CRITERIA.md`**

Add the 20 domain invariants and the UI/E2E cases from design spec §26 as explicit numbered acceptance criteria. Keep existing parser/order/export/package acceptance intact.

- [ ] **Step 7: Update `AGENTS.md` reading order**

Append after existing product/testing docs:

```md
7. `DESIGN.md`
8. `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md`
9. `docs/superpowers/plans/2026-09-03-rebalancing-module-implementation.md`
```

Do not remove the base product documents.

- [ ] **Step 8: Verify docs and commit**

```bash
git diff --check
rg -n "донор|MANUAL_ONLY|residualPurchaseQty|Сокращение закупки" docs AGENTS.md
git add docs AGENTS.md
git commit -m "docs: promote rebalancing contracts"
```

Expected: no rule allows donor below MAX or automatic `MANUAL_ONLY`.

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
import { expect, it } from 'vitest';
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

Run `npm test -- --run tests/domain/geography.test.ts`; expected RED because the module does not exist.

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

export interface RebalanceScenarioIssue {
  code: 'INVALID_QTY' | 'INVALID_MANUAL_TRANSFER';
  transferKey: string | null;
  message: string;
}

export interface RebalanceScenarioResult {
  plan: RebalancePlan;
  issues: RebalanceScenarioIssue[];
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

Same-branch pairs are never persisted or rendered as editable settings.

- [ ] **Step 4: Upgrade IndexedDB to v2 without dropping old stores**

```ts
interface OrdersAutoSchema extends DBSchema {
  supplierOverrides: {
    key: string;
    value: SupplierOverride;
    indexes: Record<string, never>;
  };
  settings: {
    key: string;
    value: OrderSettings;
    indexes: Record<string, never>;
  };
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
import { geographyPairKey } from '../domain/geography';
import type { GeographyPairSetting } from '../domain/types';
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
    await tx.store.put(setting, geographyPairKey(setting.branchA, setting.branchB));
  }
  await tx.done;
}
```

- [ ] **Step 6: Add persistence regression and run GREEN**

Extend `tests/persistence/persistence.test.ts` to save two geography pairs, reopen the DB, assert both relations, and assert existing `supplierOverrides`/`settings` still survive v2.

```bash
npm test -- --run tests/domain/geography.test.ts tests/persistence/persistence.test.ts
npm run typecheck
git add src/domain/types.ts src/domain/geography.ts src/persistence tests/domain/geography.test.ts tests/persistence/persistence.test.ts
git commit -m "feat: add rebalance geography contracts"
```

---

### Task 3: Implement deterministic automatic rebalancing proposal

**Files:**
- Create: `src/domain/rebalance.ts`
- Create: `tests/domain/rebalance.test.ts`

**Interfaces:**
- `transferKey(transfer): string`
- `routeKey(fromBranch, toBranch): string`
- `buildRebalanceProposal(demand, geography, mode): RebalancePlan`
- `summarizeRebalancePlan(demand, transfers): RebalanceSummary`

- [ ] **Step 1: Write RED invariant tests**

Create a synthetic SKU with donor `stock=35, MAX=20`, recipient A `stock=6, MAX=16`, recipient B `stock=8, MAX=13`. Assert total outgoing = 15, incoming A ≤ 10, incoming B ≤ 5, donor after = 20.

```ts
expect(plan.transfers.reduce((sum, line) => sum + line.qty, 0)).toBe(15);
expect(plan.transfers.every((line) => line.relation !== 'MANUAL_ONLY')).toBe(true);
```

Add separate tests for `NO_NORM`, `INVALID_NORM`, missing price, deterministic repeated calls, same-branch exclusion and network quantity conservation.

- [ ] **Step 2: Implement stable identities and ranks**

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

- [ ] **Step 3: Index demand by SKU and initialize remaining capacity**

```ts
const bySku = new Map<string, PricedDemandLine[]>();
for (const line of demand) {
  const bucket = bySku.get(line.skuCode) ?? [];
  bucket.push(line);
  bySku.set(line.skuCode, bucket);
}

const validNorm = (line: PricedDemandLine) =>
  line.max != null && line.max > 0 && (line.min == null || line.min <= line.max);
```

For each SKU, donor surplus is `stock - max` only when `validNorm && stock > max`; recipient gap is `deficitQty` only when `validNorm && deficitQty > 0`.

- [ ] **Step 4: Implement lexicographic candidate comparator**

```ts
interface Candidate {
  donor: PricedDemandLine;
  recipient: PricedDemandLine;
  relation: RebalanceRelation;
  transferableQty: number;
  amount: number | null;
  routeAlreadyUsed: boolean;
}

function compareCandidates(a: Candidate, b: Candidate, mode: RebalancePriorityMode) {
  const money = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;
  const criticalCmp = statusRank[b.recipient.status] - statusRank[a.recipient.status];
  const geographyCmp = relationRank[b.relation] - relationRank[a.relation];
  const moneyCmp = money(b.amount) - money(a.amount);
  const ordered = mode === 'CRITICALITY_FIRST'
    ? [criticalCmp, moneyCmp, geographyCmp]
    : [geographyCmp, criticalCmp, moneyCmp];

  for (const cmp of ordered) if (cmp !== 0) return cmp;
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

Unknown money sorts after known money only within equal higher-priority criteria.

- [ ] **Step 5: Implement the greedy allocation loop**

```ts
while (true) {
  const candidates = buildCandidatesForCurrentRemainingState();
  if (candidates.length === 0) break;
  candidates.sort((a, b) => compareCandidates(a, b, mode));
  const chosen = candidates[0]!;
  const qty = chosen.transferableQty;

  transfers.push({
    skuCode: chosen.recipient.skuCode,
    article: chosen.recipient.article,
    name: chosen.recipient.name,
    fromBranch: chosen.donor.branch,
    toBranch: chosen.recipient.branch,
    qty,
    relation: chosen.relation,
    source: 'AUTO',
    recipientStatus: chosen.recipient.status,
    unitPrice: chosen.recipient.unitPrice,
    purchaseReductionAmount:
      chosen.recipient.unitPrice == null ? null : qty * chosen.recipient.unitPrice,
  });

  decreaseRemainingSurplus(chosen.donor, qty);
  decreaseRemainingGap(chosen.recipient, qty);
  usedRoutes.add(routeKey(chosen.donor.branch, chosen.recipient.branch));
}
```

`buildCandidatesForCurrentRemainingState()` must omit `MANUAL_ONLY` and same-branch pairs and calculate `min(remainingSurplus, remainingGap)`.

- [ ] **Step 6: Implement plan summary**

```ts
const routeCount = new Set(transfers.map((line) => routeKey(line.fromBranch, line.toBranch))).size;
const skuCount = new Set(transfers.map((line) => line.skuCode)).size;
const recipientLineCount = new Set(
  transfers.map((line) => `${line.skuCode}\0${line.toBranch}`),
).size;
```

Compute total qty, known reduction, missing-price transfer count and residual known/missing purchase from the original demand minus incoming quantities.

- [ ] **Step 7: Prove both modes and commit**

Add a scarce-donor fixture where `BELOW_MIN` is `ALLOWED` and `LIGHT_RED` is `PRIORITY`. Assert `CRITICALITY_FIRST` selects `BELOW_MIN`, while `GEOGRAPHY_FIRST` selects `PRIORITY`.

```bash
npm test -- --run tests/domain/rebalance.test.ts
npm run typecheck
git add src/domain/rebalance.ts tests/domain/rebalance.test.ts
git commit -m "feat: calculate automatic rebalance proposal"
```

---

### Task 4: Implement Pareto scenarios, draft edits and manual transfers

**Files:**
- Create: `src/domain/rebalanceScenario.ts`
- Create: `tests/domain/rebalanceScenario.test.ts`

**Interfaces:**
- `createDefaultRebalanceDraft(): RebalanceDraftState`
- `selectParetoRecipientLines(plan, target): Set<string>`
- `summarizeParetoBySku(plan, target): ParetoSkuSummary`
- `buildRebalanceScenario(input): RebalanceScenarioResult`
- `validateManualTransfer(input): ManualTransferValidation`
- `plansEquivalent(left, right): boolean`

- [ ] **Step 1: Write RED Pareto and draft tests**

For known effects `70, 20, 9, 1`, assert 90% requires two `SKU × recipient` units. Add a case where one recipient is supplied by two donors; both transfers must be selected together. Add unknown-price transfers and assert they remain in the physical scenario while excluded from the percentage denominator.

- [ ] **Step 2: Implement default draft and recipient-line Pareto selection**

```ts
export function createDefaultRebalanceDraft(): RebalanceDraftState {
  return {
    paretoTarget: 90,
    excludedTransferKeys: [],
    qtyEdits: [],
    manualTransfers: [],
  };
}

const recipientDecisionKey = (line: RebalanceTransfer) =>
  `${line.skuCode}\0${line.toBranch}`;
```

Aggregate known financial effect by `recipientDecisionKey`. For target 80/90/95, select the minimum known-effect units reaching the target **and also keep every unknown-price recipient unit in the scenario**; unknown units do not contribute to the percentage claim. For target 100, keep every transfer.

- [ ] **Step 3: Implement analytical SKU grouping without changing the scenario**

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

`summarizeParetoBySku()` aggregates proposal transfers by `skuCode`; no call from this function may mutate or feed the allocation/scenario path.

- [ ] **Step 4: Apply scenario transforms in a fixed order**

```ts
export function buildRebalanceScenario(input: BuildScenarioInput): RebalanceScenarioResult {
  const paretoKeys = selectParetoRecipientLines(input.proposal, input.draft.paretoTarget);
  let transfers = input.proposal.transfers.filter((line) =>
    paretoKeys.has(recipientDecisionKey(line)) || line.purchaseReductionAmount == null,
  );
  transfers = applyExclusions(transfers, input.draft.excludedTransferKeys);
  const qtyResult = applyQtyEdits(transfers, input.draft.qtyEdits, input.demand);
  const manualResult = applyManualTransfers(
    qtyResult.transfers,
    input.draft.manualTransfers,
    input.demand,
    input.geography,
  );
  const issues = [...qtyResult.issues, ...manualResult.issues];
  return {
    plan: {
      mode: input.proposal.mode,
      transfers: manualResult.transfers,
      summary: summarizeRebalancePlan(input.demand, manualResult.transfers),
    },
    issues,
  };
}
```

Invalid edit quantities produce `RebalanceScenarioIssue`; never silently clamp.

- [ ] **Step 5: Implement manual transfer validation against current scenario**

```ts
export interface ManualTransferValidation {
  valid: boolean;
  maxQty: number;
  relation: RebalanceRelation;
  requiresManualOnlyConfirmation: boolean;
  message: string | null;
}
```

Compute remaining donor surplus after existing outgoing lines for the same SKU and remaining recipient gap after existing incoming lines. `maxQty = min(remainingSurplus, remainingGap)`. Reject same branch, negative qty, qty above max, missing/invalid MAX, or missing SKU/branch line. `MANUAL_ONLY` is valid only as explicit manual path and sets `requiresManualOnlyConfirmation=true`.

- [ ] **Step 6: Keep one transfer identity per SKU/from/to**

```ts
const key = transferKey({ skuCode: input.skuCode, fromBranch: input.fromBranch, toBranch: input.toBranch });
const withoutExisting = transfers.filter((line) => transferKey(line) !== key);
const next = [...withoutExisting, buildManualTransfer(input)];
```

If the key already existed, replace its quantity and mark source `MANUAL`; do not duplicate the physical line.

- [ ] **Step 7: Run GREEN and commit**

```bash
npm test -- --run tests/domain/rebalanceScenario.test.ts tests/domain/rebalance.test.ts
npm run typecheck
git add src/domain/rebalanceScenario.ts tests/domain/rebalanceScenario.test.ts
git commit -m "feat: add rebalance draft and pareto scenarios"
```

Tests must cover exclusions, qty=0, invalid qty issue, manual-only confirmation flag, donor/recipient MAX invariants, analytics-only SKU grouping and unknown-price quantity retention.

---

### Task 5: Add residual purchase projection and route orders through it

**Files:**
- Create: `src/domain/residualDemand.ts`
- Modify: `src/domain/orders.ts`
- Modify: `src/app/selectors.ts`
- Create: `tests/domain/residualDemand.test.ts`
- Modify: `tests/domain/orders.test.ts`
- Modify: `tests/ui/useDerivedState.test.tsx`

**Interfaces:**
- `buildResidualPurchaseDemand(demand, approvedPlan): PurchaseDemandLine[]`
- `buildOrderProjection()` consumes `PurchaseDemandLine[]` and uses `residualPurchaseQty` as `calculatedQty`.
- `DerivedState` exposes original `demand`, proposal, scenario result, purchase demand and order projection.

- [ ] **Step 1: Write RED residual tests**

```ts
const residual = buildResidualPurchaseDemand(demand, approvedPlan);
const residualLine = residual.find((line) => line.skuCode === 'SKU1' && line.branch === 'Рязань')!;
expect(residualLine.deficitQty).toBe(20);
expect(residualLine.approvedIncomingQty).toBe(12);
expect(residualLine.residualPurchaseQty).toBe(8);
expect(residualLine.residualPurchaseAmount).toBe(800);
```

Also assert null price → null residual amount, no approved plan → residual qty equals original deficit, and source demand objects remain unchanged.

- [ ] **Step 2: Implement residual projection**

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

```ts
if (
  line.residualPurchaseQty <= 0 ||
  line.status === 'INVALID_NORM' ||
  line.status === 'NO_NORM'
) {
  continue;
}

const editKey = `${line.skuCode}\0${line.branch}`;
const calculatedQty = line.residualPurchaseQty;
const orderQty = editBySkuBranch.get(editKey) ?? calculatedQty;
```

Set `OrderLine.calculatedQty = calculatedQty`; warning compares `orderQty > calculatedQty`. Never overwrite `line.deficitQty`.

- [ ] **Step 4: Extend `DerivedState` and central derivation order**

```ts
export interface DerivedState {
  resolutions: SupplierResolution[];
  demand: PricedDemandLine[];
  rebalanceProposal: RebalancePlan;
  rebalanceScenario: RebalanceScenarioResult;
  purchaseDemand: PurchaseDemandLine[];
  projection: WorkflowOrderProjection;
}
```

```ts
const demand = priceDemand(calculateDemand(state.minMax), state.minMax.skus, resolutions);
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
const purchaseDemand = buildResidualPurchaseDemand(demand, state.approvedRebalancePlan);
const baseProjection = buildOrderProjection(
  purchaseDemand,
  resolutions,
  state.edits,
  state.settings,
);
```

Before imports, return empty plans/results with current mode and zero summaries.

- [ ] **Step 5: Run GREEN and commit**

Add order regression: approved incoming 12 changes `calculatedQty` 20 → 8 while `demand.deficitQty` stays 20.

```bash
npm test -- --run tests/domain/residualDemand.test.ts tests/domain/orders.test.ts tests/ui/useDerivedState.test.tsx
npm run typecheck
git add src/domain/residualDemand.ts src/domain/orders.ts src/app/selectors.ts tests/domain/residualDemand.test.ts tests/domain/orders.test.ts tests/ui/useDerivedState.test.tsx
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
- AppState owns geography + session mode/draft/approved snapshot.
- `applyRebalanceApproval()` invalidates only affected purchase workflow metadata.
- `AppDialog` is the canonical app-owned modal owner for the touched shell/workflow.

- [ ] **Step 1: Extend AppState and defaults**

```ts
geographySettings: GeographyPairSetting[];
rebalanceMode: RebalancePriorityMode;
rebalanceDraft: RebalanceDraftState;
approvedRebalancePlan: RebalancePlan | null;
```

Use:

```ts
geographySettings: [],
rebalanceMode: 'CRITICALITY_FIRST',
rebalanceDraft: createDefaultRebalanceDraft(),
approvedRebalancePlan: null,
```

Update `tests/ui/renderWithStore.tsx::baseState()` with the same values.

- [ ] **Step 2: Load geography settings without breaking existing initialization**

```ts
Promise.all([
  getSupplierOverrides(),
  getSettings(),
  getGeographySettings().catch(() => []),
]).then(([overrides, settings, geographySettings]) => {
  setState((current) => ({
    ...current,
    overrides,
    settings,
    geographySettings,
  }));
});
```

A geography-only persistence failure falls back to `[]`; the application remains usable.

- [ ] **Step 3: Implement affected-key approval invalidation**

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

Compare old/new maps; any changed `skuCode\0branch` is affected. `applyRebalanceApproval()` removes only matching `OrderQtyEdit`, and removes review/export order IDs only when the current order contains an affected line. It sets `approvedRebalancePlan=nextPlan` and preserves unrelated workflow state.

- [ ] **Step 4: Write RED invalidation tests**

Create two branch orders with edits/review/export markers. Approve a plan affecting only one branch and assert only that branch is reset.

- [ ] **Step 5: Build shared `AppDialog` on native `<dialog>`**

```tsx
interface AppDialogProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  actions: ReactNode;
  children: ReactNode;
}
```

```tsx
useEffect(() => {
  const dialog = ref.current;
  if (!dialog) return;
  if (open && !dialog.open) dialog.showModal();
  if (!open && dialog.open) dialog.close();
}, [open]);
```

Render heading/description IDs and `<dialog aria-labelledby={titleId} aria-describedby={descriptionId}>`. Intercept native `cancel`, call `preventDefault()`, then `onClose()`. Test opening, Escape close and focus restoration.

Concrete usage test fixture:

```tsx
<AppDialog
  open={true}
  title="Пересчитать заказы?"
  description="У 2 затронутых строк есть ручные количества."
  onClose={onClose}
  actions={<button onClick={onClose}>Отмена</button>}
>
  <p>После утверждения расчётные количества изменятся.</p>
</AppDialog>
```

- [ ] **Step 6: Replace existing `window.confirm()` in `App.tsx`**

Use component state `resetConfirmOpen`. Clicking `Загрузить новые отчёты` with manual edits opens `AppDialog`; `Остаться` closes it, `Загрузить новые отчёты` runs `setState(createInitialState(...))` and closes it.

- [ ] **Step 7: Reset rebalance session state on new input snapshot**

On successful replacement of either source report set:

```ts
approvedRebalancePlan: null,
rebalanceDraft: createDefaultRebalanceDraft(),
reviewedOrderIds: [],
exportedOrderIds: [],
```

Keep `geographySettings` unchanged. This prevents stale physical/financial plan metadata when the input pair changes.

- [ ] **Step 8: Run GREEN and commit**

```bash
npm test -- --run tests/domain/rebalanceWorkflow.test.ts tests/ui/appDialog.test.tsx tests/ui/importReviewReset.test.tsx
npm run typecheck
git add src/app src/features/import/ImportPage.tsx src/domain/rebalanceWorkflow.ts src/components/AppDialog.tsx tests/domain/rebalanceWorkflow.test.ts tests/ui/appDialog.test.tsx tests/ui/renderWithStore.tsx tests/ui/importReviewReset.test.tsx
git commit -m "feat: add rebalance approval lifecycle"
```

---

### Task 7: Add the Rebalancing workspace shell, controls, KPIs and presentation filters

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/features/rebalance/RebalancePage.tsx`
- Create: `src/features/rebalance/RebalanceKpis.tsx`
- Create: `src/features/rebalance/RebalanceFilters.tsx`
- Create: `src/features/rebalance/rebalanceView.ts`
- Modify: `src/styles/app.css`
- Create: `tests/ui/rebalancePage.test.tsx`

**Interfaces:**
- `RebalancePage` consumes central derived projections; filters never recalculate allocation.
- Default mode `Критичные`, default Pareto target `90%`, analytical grouping default `Строки закупки`.

- [ ] **Step 1: Write RED navigation/workspace test**

```ts
await user.click(screen.getByRole('button', { name: 'Ребалансировка' }));
expect(screen.getByRole('heading', { name: 'Ребалансировка' })).toBeInTheDocument();
expect(screen.getByText('Закупка до')).toBeInTheDocument();
expect(screen.getByText('Сокращение закупки')).toBeInTheDocument();
expect(screen.getByText('Остаточная закупка')).toBeInTheDocument();
```

- [ ] **Step 2: Add top-level navigation and route content**

```tsx
<button
  className={state.page === 'rebalance' ? 'active' : ''}
  onClick={() => set({ page: 'rebalance' })}
>
  Ребалансировка
</button>
```

Place it after branch navigation and before `Поставщики`. Route `state.page === 'rebalance'` to `<RebalancePage />`.

- [ ] **Step 3: Keep only presentation state in the page**

```ts
const derived = derive(state);
const proposal = derived.rebalanceProposal;
const scenario = derived.rebalanceScenario.plan;
const scenarioIssues = derived.rebalanceScenario.issues;
const [grouping, setGrouping] = useState<'RECIPIENT_LINE' | 'SKU'>('RECIPIENT_LINE');
const [filters, setFilters] = useState<RebalanceFilters>(emptyRebalanceFilters);
const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(null);
```

- [ ] **Step 4: Render exact KPI layer**

```tsx
<div className="rebalance-kpis">
  <MetricCard label="Закупка до" value={purchaseBeforeLabel} />
  <MetricCard label="Сокращение закупки" value={purchaseReductionLabel} />
  <MetricCard label="Остаточная закупка" value={residualPurchaseLabel} />
</div>
<p>{`${scenario.summary.routeCount} маршрутов · ${scenario.summary.transferCount} SKU-линий · ${fmtQty(scenario.summary.totalQty)} шт.`}</p>
```

If price data is incomplete, append the exact unknown-line count; never imply a complete money total.

- [ ] **Step 5: Implement mode/Pareto/grouping controls**

```ts
set({ rebalanceMode: 'CRITICALITY_FIRST' });
set({
  rebalanceDraft: { ...state.rebalanceDraft, paretoTarget: 90 },
});
setGrouping('SKU');
```

Only `rebalanceMode` and `paretoTarget` affect derived scenario. `grouping` is analytics-only.

- [ ] **Step 6: Implement presentation filters**

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

export const emptyRebalanceFilters: RebalanceFilters = {
  query: '', amountFrom: '', amountTo: '', donor: '', recipient: '',
  relation: 'ALL', recipientStatus: 'ALL', fullGapOnly: false,
};
```

`filterScenarioTransfers(scenario.transfers, filters, demand)` returns visible lines only. Search matches code/article/name. Filters must never call `buildRebalanceProposal()` or mutate plan quantities. Non-empty search shows a real `Очистить поиск` button.

- [ ] **Step 7: Add state labels and base CSS**

```ts
const planState = state.approvedRebalancePlan == null
  ? 'Не утверждено'
  : plansEquivalent(state.approvedRebalancePlan, scenario)
    ? 'Утверждено'
    : 'Есть новый черновик';
```

Use existing CSS tokens only: `--blue`, `--line`, `--surface`, `--muted`, `--warning`, `--danger`. No gradients, glow, glass or new palette.

- [ ] **Step 8: Run GREEN and commit**

```bash
npm test -- --run tests/ui/rebalancePage.test.tsx
npm run typecheck
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
- Map and route list consume the same summaries and selection callback.

- [ ] **Step 1: Define route aggregation and RED tests**

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

Test that several SKU lines on one directed pair produce one route summary, reverse direction is another route, and filtering does not mutate original scenario summary.

- [ ] **Step 2: Implement topological node roles and deterministic coordinates**

```ts
const role = outgoing > 0 && incoming > 0
  ? 'MIXED'
  : outgoing > 0
    ? 'DONOR'
    : 'RECIPIENT';

const xByRole = { DONOR: 90, MIXED: 500, RECIPIENT: 910 } as const;
const y = 64 + indexWithinRole * 96;
const height = Math.max(420, maxRoleCount * 96 + 80);
```

Sort nodes within each role by known financial effect descending, then branch name.

- [ ] **Step 3: Render SVG connectors but semantic HTML controls**

```tsx
<div className="rebalance-flow-map" style={{ height }}>
  <svg className="rebalance-flow-lines" viewBox={`0 0 1000 ${height}`} aria-hidden="true">
    {layout.routes.map((route) => (
      <path key={route.key} d={route.path} className={`flow-line ${route.relation}`} />
    ))}
  </svg>
  {layout.nodes.map((node) => (
    <button key={node.branch} className="flow-node" style={node.style} onClick={() => onFocusBranch(node.branch)}>
      <strong>{node.branch}</strong>
      <span>{node.caption}</span>
    </button>
  ))}
  {layout.routes.map((route) => (
    <button key={route.key} className="rebalance-route-button" style={route.labelStyle} onClick={() => onSelectRoute(route.key)}>
      {route.label}
    </button>
  ))}
</div>
```

`PRIORITY` uses solid line + `Приоритетно`, `ALLOWED` dashed + `Допустимо`, manual route warning marker + `Только вручную`. Text is authoritative; color is secondary.

- [ ] **Step 4: Build always-reachable route-list fallback**

```tsx
<ul className="rebalance-route-list">
  {routes.map((route) => (
    <li key={route.key}>
      <button onClick={() => onSelectRoute(route.key)}>
        {route.fromBranch} → {route.toBranch} · {route.skuCount} SKU · {fmtQty(route.totalQty)} шт. · {relationLabel(route.relation)}
      </button>
    </li>
  ))}
</ul>
```

Expose via visible `Список маршрутов` disclosure/view switch. Keyboard activation must select the same inspector state as map click.

- [ ] **Step 5: Add branch focus and run GREEN**

```ts
const connected = routes.filter(
  (route) => route.fromBranch === focusedBranch || route.toBranch === focusedBranch,
);
```

Unrelated routes get `.is-muted`; `Показать всю сеть` clears focus. This is presentation-only.

```bash
npm test -- --run tests/domain/rebalanceView.test.ts tests/ui/rebalanceFlowMap.test.tsx tests/ui/rebalancePage.test.tsx
npm run typecheck
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
- Inspector consumes selected route summary, original demand and draft state.
- Quantity writes `RebalanceQtyEdit[]`; scenario domain validation remains authoritative.

- [ ] **Step 1: Write RED inspector test**

Assert visible columns `Код`, `Артикул`, `Номенклатура`, `До MAX получателю`, `Доступно у донора`, `Переместить`, `Сокращение закупки`. Edit 10 → 6 and assert KPI/workload preview changes while Orders remain unchanged before approval.

- [ ] **Step 2: Render route header and line table**

```tsx
<header className="route-inspector-header">
  <h2>{route.fromBranch} → {route.toBranch}</h2>
  <span>{relationLabel(route.relation)}</span>
  <strong>{route.skuCount} SKU · {fmtQty(route.totalQty)} шт. · {money(route.knownReductionAmount)}</strong>
</header>
```

Use a native table for the SKU lines because row/column comparison is the task.

- [ ] **Step 3: Implement controlled numeric editor and explicit errors**

```ts
function setTransferQty(key: string, qty: number) {
  const withoutCurrent = state.rebalanceDraft.qtyEdits.filter(
    (edit) => edit.transferKey !== key,
  );
  set({
    rebalanceDraft: {
      ...state.rebalanceDraft,
      qtyEdits: [...withoutCurrent, { transferKey: key, qty }],
    },
  });
}
```

Input uses `type="number" min="0" step="any"`; no `reportValidity()`. If domain validation returns an issue for this key, show inline text with `aria-invalid` + `aria-describedby` and disable approval until fixed.

- [ ] **Step 4: Show before/after safety proof from aggregate scenario**

```ts
const donorAfter = donor.stock - outgoingForSkuAndDonor;
const recipientAfter = recipient.stock + incomingForSkuAndRecipient;
```

Display `Донор после перемещения: X / MAX Y ✓` and `Получатель после перемещения: X / MAX Y ✓` when valid.

- [ ] **Step 5: Add exact line/route actions**

```ts
excludeTransfer(key);
restoreRecommendedTransfer(key);
excludeRoute(route.transfers.map(transferKey));
```

Buttons: `Убрать из сценария`, `Вернуть рекомендацию`, `Убрать маршрут`.

- [ ] **Step 6: Run GREEN and commit**

```bash
npm test -- --run tests/ui/rebalanceInspector.test.tsx tests/domain/rebalanceScenario.test.ts
npm run typecheck
git add src/features/rebalance/RouteInspector.tsx src/features/rebalance/RebalancePage.tsx src/styles/app.css tests/ui/rebalanceInspector.test.tsx
git commit -m "feat: edit rebalance route quantities"
```

---

### Task 10: Add explicit manual transfer builder and MANUAL_ONLY warning path

**Files:**
- Create: `src/features/rebalance/ManualTransferBuilder.tsx`
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/styles/app.css`
- Create: `tests/ui/manualTransferBuilder.test.tsx`

**Interfaces:**
- Uses `validateManualTransfer()` from Task 4.
- Native `<select>` is explicitly accepted because current Chrome/Edge platform popup geometry is acceptable for this internal desktop tool.

- [ ] **Step 1: Write RED manual path tests**

Test valid-SKU filtering, donor remaining surplus, recipient gap, same-branch exclusion, qty-over-max error, explicit `MANUAL_ONLY` warning, and no geography mutation after manual add.

- [ ] **Step 2: Build the four-field noValidate form**

```tsx
<form noValidate onSubmit={handleSubmit}>
  <label htmlFor="manual-sku">SKU</label>
  <select id="manual-sku" className="input" value={skuCode} onChange={handleSkuChange}>{skuOptions}</select>
  <label htmlFor="manual-donor">Донор</label>
  <select id="manual-donor" className="input" value={fromBranch} onChange={handleDonorChange}>{donorOptions}</select>
  <label htmlFor="manual-recipient">Получатель</label>
  <select id="manual-recipient" className="input" value={toBranch} onChange={handleRecipientChange}>{recipientOptions}</select>
  <label htmlFor="manual-qty">Количество</label>
  <input id="manual-qty" type="number" min="0" step="any" value={qtyText} onChange={handleQtyChange} />
  <Button type="submit">Добавить перемещение</Button>
</form>
```

Option copy includes `Егорьевск — доступно 15` and `Рязань — gap 10`.

- [ ] **Step 3: Implement explicit manual-only confirmation inline**

```tsx
{validation.requiresManualOnlyConfirmation && pendingInput && (
  <Alert tone="warning">
    Эта связь исключена из автоматической ребалансировки.
    <div className="inline-actions">
      <Button secondary onClick={() => setPendingInput(null)}>Отмена</Button>
      <Button onClick={() => commitManualTransfer(pendingInput)}>Добавить вручную</Button>
    </div>
  </Alert>
)}
```

Do not change the pair setting.

- [ ] **Step 4: Existing identity becomes a manual override, not a duplicate**

If `transferKey()` already exists, show `Количество существующего перемещения будет изменено` and rely on Task 4 replacement semantics.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- --run tests/ui/manualTransferBuilder.test.tsx tests/domain/rebalanceScenario.test.ts
npm run typecheck
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
- Dialog edits local draft settings and commits only on `Сохранить`.
- Full mirrored matrix reads/writes one unordered pair.
- Saved geography rebuilds proposal/scenario but never replaces approved plan automatically.

- [ ] **Step 1: Write RED symmetric matrix test**

With branches `A, B, C`, change `A ↔ B` from `MANUAL_ONLY` to `PRIORITY`; assert both visual cells announce their directional readable labels while the underlying draft contains one unordered pair setting.

- [ ] **Step 2: Open a large `AppDialog` settings surface**

```tsx
<AppDialog
  open={open}
  title="Настройка географии перемещений"
  description="Связь симметрична и действует одинаково в обе стороны."
  onClose={requestClose}
  actions={actionBar}
>
  <GeographyMatrix branches={branches} settings={draftSettings} onChange={setPairRelation} />
</AppDialog>
```

Body scrolls; title/actions remain reachable.

- [ ] **Step 3: Render mirrored cells over one unordered owner**

Diagonal cells are `—`. Editable cells are buttons whose relation cycles:

```ts
const nextRelation: Record<RebalanceRelation, RebalanceRelation> = {
  MANUAL_ONLY: 'ALLOWED',
  ALLOWED: 'PRIORITY',
  PRIORITY: 'MANUAL_ONLY',
};
```

Accessible name format: `Егорьевск ↔ Рязань: Допустимо`.

- [ ] **Step 4: Add unordered pair selection and bulk actions**

```ts
const selectedKeys = new Set<string>();
applyBulkRelation(selectedKeys, 'PRIORITY');
applyBulkRelation(selectedKeys, 'ALLOWED');
applyBulkRelation(selectedKeys, 'MANUAL_ONLY');
```

Show `Выбрано пар: N`; selection uses checkboxes and never counts mirrored cell twice.

- [ ] **Step 5: Implement save, persistence failure and dirty close**

```ts
try {
  await saveGeographySettings(draftSettings);
  set({ geographySettings: draftSettings, toast: 'Настройки географии сохранены.' });
  onSaved();
} catch {
  setSaveError('Не удалось сохранить настройки географии. Повторите попытку.');
}
```

If dirty close is requested, stay in the same dialog and show `Есть несохранённые изменения` with `Продолжить редактирование` / `Отменить изменения`; do not open nested modal.

- [ ] **Step 6: Run GREEN and commit**

```bash
npm test -- --run tests/ui/geographySettings.test.tsx tests/persistence/persistence.test.ts tests/domain/geography.test.ts
npm run typecheck
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
- Approval commits `derived.rebalanceScenario.plan` only when scenario issues are empty.
- Demand preserves original physical gap; Orders/Suppliers use residual purchase.

- [ ] **Step 1: Write RED approval integration test**

Synthetic state: recipient gap 20, scenario incoming 12, current order calculated 20, unrelated manual edit in another branch. After `Утвердить перемещения`, assert recipient calculated order qty = 8 and unrelated edit remains.

- [ ] **Step 2: Add approval consequence summary and guard**

```tsx
<Button disabled={scenarioIssues.length > 0} onClick={requestApproval}>
  Утвердить перемещения
</Button>
```

Before commit show `После утверждения: −X ₽ закупки · останется Y ₽ · N маршрутов · M SKU-линий · Q шт.`.

If affected manual order edits exist, open `AppDialog` with title `Пересчитать заказы?`, description `У N затронутых строк есть ручные количества. Они будут сброшены, потому что изменится расчётная потребность.`, actions `Отмена` / `Утвердить и пересчитать`. If no affected edits, commit directly.

- [ ] **Step 3: Commit through the domain workflow helper**

```ts
const patch = applyRebalanceApproval({
  previousApprovedPlan: state.approvedRebalancePlan,
  nextApprovedPlan: scenario,
  edits: state.edits,
  reviewedOrderIds: state.reviewedOrderIds,
  exportedOrderIds: state.exportedOrderIds,
  orders: derived.projection.orders,
});
set({
  ...patch,
  toast: 'Перемещения утверждены. Закупочная потребность и заказы пересчитаны.',
});
```

- [ ] **Step 4: Add original-vs-residual transparency to Demand**

Use `derived.purchaseDemand` indexed by `skuCode\0branch`. Keep existing `Нужно сюда = deficitQty`; when approved incoming > 0, show `Осталось заказать = residualPurchaseQty`. Never relabel original gap as residual.

- [ ] **Step 5: Add Orders/Suppliers context banners**

Orders banner when approved plan exists:

```text
В заказах учтена утверждённая ребалансировка: −X ₽ закупки · N маршрутов.
[Открыть ребалансировку]
```

Suppliers shows the same compact context but does not recalculate supplier totals itself; totals already come from residual orders.

- [ ] **Step 6: Prove approved baseline survives draft changes**

Test: approve plan, then change Pareto target/mode/quantity. UI becomes `Есть новый черновик`, while `purchaseDemand` and Orders remain based on previous approved plan until next approval.

- [ ] **Step 7: Run GREEN and commit**

```bash
npm test -- --run tests/ui/rebalanceApproval.test.tsx tests/ui/demandPage.test.tsx tests/ui/ordersPage.test.tsx tests/ui/suppliersPage.test.tsx
npm run typecheck
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

**Interfaces:**
- Production acceptance remains the existing offline `dist/ORDERS_AUTO/index.html` contract.
- Rebalance has explicit empty/no-route/missing-price/invalid-norm states and keyboard-equivalent operations.

- [ ] **Step 1: Add RED state tests**

Exact messages:

```text
В сети нет остатков выше MAX, доступных для автоматической ребалансировки.
```

```text
Есть излишек, но автоматические маршруты не настроены.
```

Also assert missing-price transfers remain by quantity, invalid norms show exclusion counts, and `MANUAL_ONLY` never appears in auto proposal.

- [ ] **Step 2: Implement explicit empty/error branches**

```tsx
if (physicalSurplusCount === 0) {
  return <EmptyState>В сети нет остатков выше MAX, доступных для автоматической ребалансировки.</EmptyState>;
}
if (proposal.transfers.length === 0 && blockedByGeographyCount > 0) {
  return (
    <EmptyState>
      Есть излишек, но автоматические маршруты не настроены.
      <Button onClick={() => setGeographyOpen(true)}>Открыть настройку географии</Button>
    </EmptyState>
  );
}
```

Missing price shows `Эффект неизвестен` plus count; `NO_NORM/INVALID_NORM` show diagnostics and are not offered as transfer inputs.

- [ ] **Step 3: Add keyboard/reduced-motion/layout coverage**

Component tests cover Tab to mode/Pareto/routes/inspector/approval, Enter/Space on route buttons, Escape on AppDialog, and focus-visible not obscured by sticky UI.

```css
@media (prefers-reduced-motion: reduce) {
  .rebalance-flow-map *,
  .rebalance-route-button {
    transition: none !important;
    animation: none !important;
  }
}
```

New overflow areas keep visible scrollbars and do not add a competing page-level scroll owner.

- [ ] **Step 4: Extend real `file://` E2E**

In `tests/e2e/offline.spec.ts`, use the existing packaged-app fixture path and perform:

```text
open production file:// index
→ import synthetic reports
→ open Ребалансировка
→ set one pair to Приоритетно
→ choose 90%
→ select route
→ edit transfer quantity
→ approve
→ open Заказы
→ assert residual calculated quantity
```

Preserve existing assertions: no page/console errors and no HTTP/HTTPS runtime requests.

- [ ] **Step 5: Run Frontend Design Premium static audit with a resolved skill path**

From repository root:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
SKILL_DIR="$(find "$HOME" -type d -path '*/frontend-design-premium' -print -quit)"
test -n "$SKILL_DIR"
python "$SKILL_DIR/scripts/audit_project.py" "$REPO_ROOT" --mode strict --no-write
rg -n "window\.(alert|confirm|prompt)|onClick=\{.*div" src
```

Resolve touched-workflow findings. The grep should return no browser-native dialog call in the modified shell/workflow.

- [ ] **Step 6: Run full engineering gates**

```bash
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

Expected: all pass; offline package validation and Chrome `file://` smoke remain green.

- [ ] **Step 7: Manually inspect production UI**

Open `dist/ORDERS_AUTO/index.html` by `file://` in current Chrome/Edge. Inspect around 1440 px and around 1024 px / 200% zoom. Verify map, route list, inspector, geography matrix, keyboard focus and reduced-motion behavior remain usable; do not introduce an unrelated responsive redesign.

- [ ] **Step 8: Final drift check and commit**

```bash
git diff --check
rg -n "Приоритетно|Допустимо|Только вручную|Сокращение закупки|Остаточная закупка" src docs
git add src tests docs
git commit -m "test: verify offline rebalance workflow"
```

Compare implementation with `DESIGN.md`, approved spec and authoritative docs from Task 1 before claiming completion.

---

## Execution order and review gates

Implement Tasks 1–13 strictly in order because later interfaces depend on earlier contracts.

```text
Gate A — Tasks 1–2: authoritative contracts + persistence schema
Gate B — Tasks 3–5: pure domain engine + residual order integration
Gate C — Task 6: lifecycle / invalidation / dialog owner
Gate D — Tasks 7–11: user-facing rebalancing workspace
Gate E — Task 12: approval + downstream integration
Gate F — Task 13: full verification / accessibility / file:// acceptance
```

At every gate:

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

1. Auto proposal never takes donor below MAX and never uses `MANUAL_ONLY`.
2. Both priority modes produce deterministic, tested plans.
3. Pareto 80/90/95/100 works on `SKU × recipient`; unknown-price transfer units remain physically present but outside the known-effect denominator; `SKU` grouping remains analytics-only.
4. Manual transfers obey MAX invariants and explicit manual-only warning semantics.
5. Geography matrix is symmetric, persists between sessions/imports and defaults unknown pairs to `MANUAL_ONLY`.
6. Proposal/draft do not change orders; only approved plan creates residual purchase quantities.
7. Original `deficitQty` remains intact and visible as physical gap.
8. Approval resets only affected manual order edits/review/export state.
9. A new input snapshot clears draft/approved rebalance state but preserves geography.
10. Workspace shows `Закупка до / Сокращение закупки / Остаточная закупка` and `маршруты / SKU-линии / единицы`.
11. Flow-map and route-list expose the same actionable routes; all core actions work without drag and by keyboard.
12. Demand/Suppliers/Orders explain why purchase totals differ from original demand after approval.
13. Empty/no-route/missing-price/invalid-norm states are explicit and actionable.
14. No external graph/map/runtime service or new runtime network dependency exists.
15. `npm run typecheck`, `npm test -- --run`, `npm run build`, `npm run test:e2e` all pass.
16. Production `dist/ORDERS_AUTO/index.html` runs by double-click / `file://` in current Chrome/Edge and the existing rolling Release packaging contract remains intact.
