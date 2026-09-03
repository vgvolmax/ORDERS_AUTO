# Rebalancing Integration Contract Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть интеграционные пробелы базового Rebalancing implementation plan так, чтобы отдельная вкладка «Ребалансировка» безопасно встраивалась в существующий ORDERS_AUTO без ложных supplier decisions, stale review/export state, потери geography settings и устаревших финансовых KPI.

**Architecture:** Этот файл является нормативным amendment к `2026-09-03-rebalancing-module-implementation.md`, а не отдельной фичей. Базовый pipeline сохраняется: исходный demand неизменяем, approved quantities формируют residual purchase, Suppliers/Orders читают residual projection; approved physical plan хранится как snapshot, а его денежный view репрайсится текущими ценами. Runtime dependencies и deployment model не меняются.

**Tech Stack:** существующие React 19, TypeScript strict, Vite, IndexedDB через `idb`, Vitest, React Testing Library, Playwright, CSS/SVG. Новые runtime dependencies не добавлять.

**Spec:** `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md` + normative clarification `docs/superpowers/specs/2026-09-03-rebalancing-integration-clarifications.md`.

## Precedence and execution rule

1. Сначала прочитать базовый implementation plan.
2. Затем прочитать этот amendment.
3. Выполнять исходные Tasks 1–13 в том же порядке, но для перечисленных ниже tasks **заменить/дополнить** соответствующие шаги этим документом.
4. При конфликте этот amendment имеет приоритет.
5. Не создавать Tasks 14+ ради этих исправлений: они должны войти в исходные архитектурные этапы до runtime merge.

## Global Constraints added by this amendment

- Supplier decision eligibility определяется по `residualPurchaseQty > 0`, не по исходному `deficitQty > 0` после появления approved plan.
- Targeted approval invalidation использует union previous + next order projections.
- Любой import reset сохраняет persisted `geographySettings`.
- Approved transfer quantities frozen для текущего snapshot; price-only change не меняет физический approval.
- Денежный view approved plan репрайсится по текущей recipient price.
- Numeric wizard copy `Шаг N из 4` удалить после появления Rebalancing top-level workspace.
- Geography relation lookup внутри proposal индексируется один раз на расчёт.

---

### Amendment Task 1: Promote the clarified contracts into authoritative docs

**Patches base Task 1.**

**Files:**
- Modify: `docs/product/SPEC.md`
- Modify: `docs/data/DATA_CONTRACTS.md`
- Modify: `docs/data/DERIVED_PROJECTIONS.md`
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/ux/UX_AND_EXPORT.md`
- Modify: `docs/testing/ACCEPTANCE_CRITERIA.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: base design spec + integration clarification spec.
- Produces: authoritative docs that Tasks 2–13 must follow.

- [ ] **Step 1: Extend `SPEC.md` residual purchasing rule**

After the base plan's residual formula, add this exact semantic rule:

```md
После утверждения ребалансировки решение «что ещё требуется купить» принимается
только по `residualPurchaseQty`. Это относится к Suppliers целиком: eligibility
для выбора поставщика, problem counts/amounts и supplier summaries не могут
продолжать использовать исходный `deficitQty` как признак оставшейся закупки.
Исходный `deficitQty` остаётся физическим контекстом Demand.
```

- [ ] **Step 2: Add approved-plan repricing semantics to `SPEC.md` and `DERIVED_PROJECTIONS.md`**

Document:

```text
ApprovedRebalancePlan (frozen physical quantities)
  + current PricedDemandLine[]
  -> repriced approved financial view
```

State explicitly:

```md
Смена supplier resolution / unit price не инвалидирует approved quantities.
`residualPurchaseQty` остаётся quantity-derived. Денежный эффект approved plan
пересчитывается по текущей цене получателя; snapshot price внутри transfer не
является authoritative current-money field.
```

- [ ] **Step 3: Add previous+next invalidation to architecture/data docs**

```text
changed SKU×branch recipient keys
  -> previous order projection order IDs
  UNION
  -> next order projection order IDs
  -> targeted edit/review/export invalidation
```

Do not document old-projection-only invalidation.

- [ ] **Step 4: Add reset persistence matrix**

```text
                         New input snapshot
geographySettings              KEEP
rebalanceDraft                 RESET
approvedRebalancePlan          RESET
review/export session state    RESET as defined by import workflow
```

- [ ] **Step 5: Remove wizard semantics from `UX_AND_EXPORT.md`**

State that the sidebar is the workflow owner. Do not describe `Поставщики` or `Заказы` as `Шаг 3/4` / `Шаг 4/4` after Rebalancing is introduced.

- [ ] **Step 6: Add acceptance regressions**

At minimum add the 11 acceptance additions from `rebalancing-integration-clarifications.md §8` as numbered criteria.

- [ ] **Step 7: Verify and commit together with base Task 1 docs**

```bash
git diff --check
rg -n "residualPurchaseQty|previous.*next|geographySettings|repric|Шаг .* из 4" docs AGENTS.md
```

Expected: authoritative docs contain the four integration rules; no authoritative UX text requires the obsolete four-step wizard.

---

### Amendment Task 2: Index geography lookup once per domain calculation

**Patches base Task 2 and Task 3.**

**Files:**
- Modify/Create per base plan: `src/domain/geography.ts`
- Modify/Create per base plan: `src/domain/rebalance.ts`
- Modify: `tests/domain/geography.test.ts`
- Modify: `tests/domain/rebalance.test.ts`

**Interfaces:**
- Produces: `buildGeographyIndex(settings)` and O(1) `getRebalanceRelation(index, branchA, branchB)`.
- `buildRebalanceProposal()` constructs the index once and reuses it for all candidates.

- [ ] **Step 1: Replace the array-search lookup contract**

Use:

```ts
export type GeographyIndex = ReadonlyMap<string, RebalanceRelation>;

export function buildGeographyIndex(
  settings: GeographyPairSetting[],
): Map<string, RebalanceRelation> {
  const index = new Map<string, RebalanceRelation>();
  for (const setting of settings) {
    if (normalizeKey(setting.branchA) === normalizeKey(setting.branchB)) continue;
    index.set(
      geographyPairKey(setting.branchA, setting.branchB),
      setting.relation,
    );
  }
  return index;
}

export function getRebalanceRelation(
  index: GeographyIndex,
  branchA: string,
  branchB: string,
): RebalanceRelation {
  return index.get(geographyPairKey(branchA, branchB)) ?? 'MANUAL_ONLY';
}
```

Do not keep a hot-path overload that calls `settings.find(...)` for every candidate.

- [ ] **Step 2: Update geography tests**

```ts
const index = buildGeographyIndex([
  { branchA: 'Рязань', branchB: 'Коломна', relation: 'PRIORITY' },
]);
expect(getRebalanceRelation(index, 'Коломна', 'Рязань')).toBe('PRIORITY');
expect(getRebalanceRelation(index, 'Рязань', 'Москва')).toBe('MANUAL_ONLY');
```

- [ ] **Step 3: Build the index once in proposal construction**

At the beginning of `buildRebalanceProposal()`:

```ts
const geographyIndex = buildGeographyIndex(geography);
```

Every donor × recipient lookup in that invocation uses `geographyIndex`.

- [ ] **Step 4: Manual validation may reuse/build one index per validation call**

`validateManualTransfer()` may build an index from the current settings once per user validation invocation; it must not introduce a global mutable cache.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- --run tests/domain/geography.test.ts tests/domain/rebalance.test.ts tests/domain/rebalanceScenario.test.ts
npm run typecheck
```

---

### Amendment Task 5: Separate frozen physical approval from current financial view

**Patches base Task 5.**

**Files:**
- Modify: `src/domain/types.ts`
- Modify/Create: `src/domain/residualDemand.ts`
- Create: `src/domain/rebalanceFinancials.ts`
- Modify: `src/app/selectors.ts`
- Create: `tests/domain/rebalanceFinancials.test.ts`
- Modify: `tests/domain/residualDemand.test.ts`
- Modify: `tests/ui/useDerivedState.test.tsx`

**Interfaces:**
- `buildResidualPurchaseDemand(demand, approvedPlan)` continues to consume only approved quantities.
- `repriceRebalancePlan(demand, approvedPlan): RebalancePlan | null` returns a derived copy for current financial presentation.
- `DerivedState` exposes `approvedRebalanceView` separately from `state.approvedRebalancePlan`.

- [ ] **Step 1: Write RED repricing tests**

Fixture:

```ts
const approvedPlan = planWithTransfer({
  skuCode: 'SKU1',
  fromBranch: 'A',
  toBranch: 'B',
  qty: 10,
  unitPrice: 100,
  purchaseReductionAmount: 1000,
});

const currentDemand = demandWithRecipientPrice('SKU1', 'B', 130);
const repriced = repriceRebalancePlan(currentDemand, approvedPlan)!;

expect(repriced.transfers[0]!.qty).toBe(10);
expect(repriced.transfers[0]!.unitPrice).toBe(130);
expect(repriced.transfers[0]!.purchaseReductionAmount).toBe(1300);
expect(repriced.summary.knownPurchaseReductionAmount).toBe(1300);
```

Also test current price `null`:

```ts
expect(repriced.transfers[0]!.qty).toBe(10);
expect(repriced.transfers[0]!.purchaseReductionAmount).toBeNull();
expect(repriced.summary.missingPriceTransferCount).toBe(1);
```

- [ ] **Step 2: Implement repricing without mutating approved state**

```ts
export function repriceRebalancePlan(
  demand: PricedDemandLine[],
  plan: RebalancePlan | null,
): RebalancePlan | null {
  if (!plan) return null;

  const recipientByKey = new Map(
    demand.map((line) => [`${line.skuCode}\0${line.branch}`, line] as const),
  );

  const transfers = plan.transfers.map((transfer) => {
    const recipient = recipientByKey.get(
      `${transfer.skuCode}\0${transfer.toBranch}`,
    );
    const unitPrice = recipient?.unitPrice ?? null;
    return {
      ...transfer,
      unitPrice,
      purchaseReductionAmount:
        unitPrice == null ? null : transfer.qty * unitPrice,
    };
  });

  return {
    ...plan,
    transfers,
    summary: summarizeRebalancePlan(demand, transfers),
  };
}
```

`state.approvedRebalancePlan` remains unchanged.

- [ ] **Step 3: Keep residual quantity independent from repriced money**

Regression:

```ts
const before = buildResidualPurchaseDemand(demandAt100, approvedPlan);
const after = buildResidualPurchaseDemand(demandAt130, approvedPlan);
expect(beforeRecipient.residualPurchaseQty).toBe(afterRecipient.residualPurchaseQty);
```

Only `residualPurchaseAmount` changes with current price.

- [ ] **Step 4: Expose current approved financial view**

Extend `DerivedState`:

```ts
approvedRebalanceView: RebalancePlan | null;
```

Derive:

```ts
const approvedRebalanceView = repriceRebalancePlan(
  demand,
  state.approvedRebalancePlan,
);
```

Use this for current approved KPI/banner money. Use `state.approvedRebalancePlan` for frozen approved quantities/residual calculation.

- [ ] **Step 5: Make plan equivalence price-insensitive**

`plansEquivalent()` must not compare `unitPrice`, `purchaseReductionAmount` or summary money.

It compares operational plan semantics only. Minimum contract:

```ts
mode
sorted transferKey
qty
relation
source
```

A price-only change with identical operational transfers returns `true`.

Add test:

```ts
expect(plansEquivalent(planAt100, planAt130)).toBe(true);
```

- [ ] **Step 6: Run GREEN**

```bash
npm test -- --run tests/domain/rebalanceFinancials.test.ts tests/domain/residualDemand.test.ts tests/domain/rebalanceScenario.test.ts tests/ui/useDerivedState.test.tsx
npm run typecheck
```

---

### Amendment Task 6: Preserve geography on reset and invalidate previous + next orders

**Patches base Task 6.**

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/appStore.ts`
- Modify: `src/features/import/ImportPage.tsx`
- Modify: `src/domain/rebalanceWorkflow.ts`
- Modify: `tests/domain/rebalanceWorkflow.test.ts`
- Modify: `tests/ui/importReviewReset.test.tsx`

**Interfaces:**
- `createInitialState()` can receive preserved geography.
- `applyRebalanceApproval()` consumes both previous and next order projections.

- [ ] **Step 1: Make geography preservation explicit in initial/reset helper**

Use this shape or an equivalent typed object argument:

```ts
function createInitialState(
  overrides: AppState['overrides'] = [],
  settings: AppState['settings'] = defaults,
  geographySettings: AppState['geographySettings'] = [],
): AppState {
  return {
    // existing fields...
    overrides,
    settings,
    geographySettings,
    rebalanceMode: 'CRITICALITY_FIRST',
    rebalanceDraft: createDefaultRebalanceDraft(),
    approvedRebalancePlan: null,
  };
}
```

- [ ] **Step 2: Preserve geography in `Загрузить новые отчёты` reset**

Replace any reset equivalent to:

```ts
createInitialState(state.overrides, state.settings)
```

with:

```ts
createInitialState(
  state.overrides,
  state.settings,
  state.geographySettings,
)
```

- [ ] **Step 3: Replacement of either source file resets only snapshot/session plan state**

On successful accepted replacement:

```ts
rebalanceDraft: createDefaultRebalanceDraft(),
approvedRebalancePlan: null,
reviewedOrderIds: [],
exportedOrderIds: [],
```

Do **not** include `geographySettings` in the patch.

- [ ] **Step 4: Write RED reset regression**

UI test starts with non-empty geography + approved plan, triggers `Загрузить новые отчёты`, confirms app dialog, and asserts after reset:

```ts
expect(state.geographySettings).toEqual(savedGeography);
expect(state.approvedRebalancePlan).toBeNull();
expect(state.rebalanceDraft).toEqual(createDefaultRebalanceDraft());
```

Add equivalent file-replacement regression.

- [ ] **Step 5: Extend approval helper inputs**

Use:

```ts
interface ApplyRebalanceApprovalInput {
  previousApprovedPlan: RebalancePlan | null;
  nextApprovedPlan: RebalancePlan;
  edits: OrderQtyEdit[];
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
  previousOrders: Order[];
  nextOrders: Order[];
}
```

- [ ] **Step 6: Compute affected order IDs from union of projections**

```ts
function orderIdsContainingKeys(
  orders: Order[],
  affectedKeys: Set<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const order of orders) {
    if (
      order.lines.some((line) =>
        affectedKeys.has(`${line.skuCode}\0${line.branch}`),
      )
    ) {
      ids.add(order.id);
    }
  }
  return ids;
}

const previousIds = orderIdsContainingKeys(input.previousOrders, affectedKeys);
const nextIds = orderIdsContainingKeys(input.nextOrders, affectedKeys);
const affectedOrderIds = new Set([...previousIds, ...nextIds]);
```

Then remove review/export IDs only from this union.

- [ ] **Step 7: Add disappearing and reappearing line tests**

Case A — `positive → 0`:

```text
previous order contains SKU1
next order no longer contains SKU1
same order also contains unrelated SKU2
```

The order review/export marker must reset.

Case B — `0 → positive`:

```text
previous order exists because of SKU2 but has no SKU1
next order gains SKU1
```

The order review/export marker must reset.

Case C — unrelated order remains reviewed/exported and unrelated edit survives.

- [ ] **Step 8: Run GREEN**

```bash
npm test -- --run tests/domain/rebalanceWorkflow.test.ts tests/ui/importReviewReset.test.tsx tests/ui/appDialog.test.tsx
npm run typecheck
```

---

### Amendment Task 7: Remove obsolete numeric wizard copy

**Patches base Task 7 and Task 12 UI integration.**

**Files:**
- Modify: `src/features/import/ImportPage.tsx`
- Modify: `src/features/suppliers/SuppliersPage.tsx`
- Modify: `src/features/orders/OrdersPage.tsx`
- Modify tests for those pages.

**Interfaces:**
- Sidebar remains the navigation owner.
- No routing/state change is introduced by this copy cleanup.

- [ ] **Step 1: Write RED copy regression**

After imported app shell renders all top-level destinations:

```ts
expect(screen.queryByText(/Шаг \d+ из 4/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Replace numeric eyebrow copy**

Use stable semantic labels:

```text
ImportPage:    Данные
SuppliersPage: Закупка
OrdersPage:    Закупка
```

Do not change existing page `h1` or sidebar destination names.

- [ ] **Step 3: Run focused UI tests**

```bash
npm test -- --run tests/ui/import*.test.tsx tests/ui/suppliersPage.test.tsx tests/ui/ordersPage.test.tsx tests/ui/rebalancePage.test.tsx
npm run typecheck
```

---

### Amendment Task 12: Make Suppliers fully residual and approval preview two-sided

**Patches base Task 12.**

**Files:**
- Modify: `src/features/rebalance/RebalancePage.tsx`
- Modify: `src/features/suppliers/SuppliersPage.tsx`
- Modify: `src/app/selectors.ts`
- Modify: `tests/ui/rebalanceApproval.test.tsx`
- Modify: `tests/ui/suppliersPage.test.tsx`

**Interfaces:**
- Supplier operational eligibility consumes `derived.purchaseDemand`.
- Approval computes both current and hypothetical next order projections before targeted invalidation.
- Approved money shown downstream comes from `derived.approvedRebalanceView`.

- [ ] **Step 1: Write RED supplier fully-covered regression**

Fixture:

```text
SKU1 deficit: branch B = 10
approved incoming: branch B = 10
residualPurchaseQty = 0
supplier resolution = MANUAL_REQUIRED
```

Assert:

```ts
expect(screen.queryByText(/SKU1/)).not.toBeInTheDocument(); // inside Требуют решения
expect(screen.getByText(/Требуют решения/)).toHaveTextContent('0');
```

Do not assert SKU1 disappears from Demand; only from remaining supplier-purchase decisions.

- [ ] **Step 2: Write RED partial residual regression**

Same SKU needed in B and C; B fully covered, C residual > 0. Assert supplier resolution is still required once at SKU-level and problem amount reflects only residual purchasing.

- [ ] **Step 3: Switch supplier decision pool to `purchaseDemand`**

Replace current eligibility based on:

```ts
derived.demand.filter((line) => line.deficitQty > 0)
```

with:

```ts
derived.purchaseDemand.filter((line) => line.residualPurchaseQty > 0)
```

Build:

```ts
const neededSkuCodes = new Set(
  derived.purchaseDemand
    .filter((line) => line.residualPurchaseQty > 0)
    .map((line) => line.skuCode),
);
```

- [ ] **Step 4: Compute problem demand/amount from residual fields**

```ts
const problemDemand = derived.purchaseDemand.filter(
  (line) =>
    problemSkuCodes.has(line.skuCode) && line.residualPurchaseQty > 0,
);

const problemAmount = problemDemand.some(
  (line) => line.residualPurchaseAmount == null,
)
  ? null
  : problemDemand.reduce(
      (sum, line) => sum + (line.residualPurchaseAmount ?? 0),
      0,
    );
```

- [ ] **Step 5: Make supplier summary `belowMinSkuCount` residual-aware**

`buildSupplierSummaries()` accepts `PurchaseDemandLine[]` (or an indexed residual view) and counts `BELOW_MIN` only where `residualPurchaseQty > 0`.

Do not reinterpret stock status itself; only suppress already-covered purchase lines from the purchasing summary.

- [ ] **Step 6: Build hypothetical next projection before approval**

Inside approval handler:

```ts
const nextPurchaseDemand = buildResidualPurchaseDemand(
  derived.demand,
  scenario,
);
const nextBaseProjection = buildOrderProjection(
  nextPurchaseDemand,
  derived.resolutions,
  state.edits,
  state.settings,
);
```

Pass:

```ts
previousOrders: derived.projection.orders,
nextOrders: nextBaseProjection.orders,
```

to `applyRebalanceApproval()`.

Do not commit this hypothetical projection to state; normal `derive()` rebuilds after approval.

- [ ] **Step 7: Use repriced approved view for money context**

Orders/Suppliers banners and any approved financial KPI use:

```ts
derived.approvedRebalanceView?.summary.knownPurchaseReductionAmount
```

plus its missing-price count, not stale transfer snapshot sums.

- [ ] **Step 8: Prove price-only update behavior**

UI/integration test:

```text
approve 10 units at 100 ₽
change supplier so current price becomes 130 ₽
```

Assert:

```text
approved qty remains 10
residual qty unchanged
Сокращение закупки becomes 1 300 ₽
plan state is not «Есть новый черновик» solely because of price change
```

- [ ] **Step 9: Run GREEN**

```bash
npm test -- --run tests/ui/rebalanceApproval.test.tsx tests/ui/suppliersPage.test.tsx tests/ui/ordersPage.test.tsx tests/domain/rebalanceFinancials.test.ts tests/domain/rebalanceWorkflow.test.ts
npm run typecheck
```

---

### Amendment Task 13: Extend final E2E/acceptance for the integration edges

**Patches base Task 13.**

**Files:**
- Modify: `tests/e2e/offline.spec.ts`
- Modify/create focused UI/domain tests from earlier amendment tasks.

**Interfaces:**
- Existing `file://` acceptance remains authoritative.

- [ ] **Step 1: Extend the real `file://` flow after approval**

After the base scenario approves a transfer that fully covers one recipient line:

```text
→ open Поставщики
→ assert fully covered SKU is absent from Требуют решения
→ open Заказы
→ assert residual calculated quantity
```

- [ ] **Step 2: Add geography-preservation UI regression outside E2E if file chooser mechanics make E2E brittle**

Component/integration coverage is sufficient for persistence/reset mechanics provided the production E2E still covers one complete import → rebalance → approve → orders path.

- [ ] **Step 3: Add stale-wizard grep**

```bash
rg -n "Шаг [0-9]+ из 4" src
```

Expected: no matches.

- [ ] **Step 4: Add hot-path lookup grep/self-review**

```bash
rg -n "settings\.find|getRebalanceRelation" src/domain
```

Inspect every result. Expected: automatic proposal path uses a prebuilt geography index; no candidate loop performs array `.find()` on geography settings.

- [ ] **Step 5: Run full verification**

```bash
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

Expected: all pass, including existing offline/no-network/package assertions.

---

## Revised Definition of Done

The base plan's 16 DoD items remain mandatory, plus all items below:

17. Supplier decision problems/counts/amounts use residual purchase after approval; a fully covered SKU does not demand a supplier solely because original `deficitQty > 0`.
18. Approval invalidation uses previous + next order projections and covers both disappearing and reappearing lines.
19. `geographySettings` survives `Загрузить новые отчёты` and replacement of either source report while draft/approved plan resets.
20. Approved physical transfer quantities remain frozen across supplier-price changes in the same snapshot.
21. Approved financial KPI/routes/banners are repriced from current recipient prices and expose missing-price incompleteness.
22. Price-only changes do not create a false `Есть новый черновик` state.
23. Runtime UI contains no obsolete `Шаг N из 4` copy after Rebalancing becomes a top-level workspace.
24. Automatic proposal builds one geography index per calculation and performs indexed pair lookups.
25. Existing Demand physical-gap semantics, Suppliers/Orders behavior without approval, export behavior, offline `file://` packaging and existing visual language remain regression-covered.

## Final drift check

Before claiming the Rebalancing implementation complete, compare runtime behavior against all four documents in this order:

1. authoritative product/data/UX/testing docs updated in Task 1;
2. `docs/superpowers/specs/2026-09-03-rebalancing-module-design.md`;
3. `docs/superpowers/specs/2026-09-03-rebalancing-integration-clarifications.md`;
4. base implementation plan + this amendment.

No implementation shortcut may restore supplier decisions based on original deficit, old-only approval invalidation, reset geography to defaults, or treat snapshot transfer price as authoritative current money.