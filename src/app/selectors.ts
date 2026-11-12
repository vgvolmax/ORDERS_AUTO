import {
  buildPurchaseDemand,
  type PurchaseDemandLine,
} from '../domain/purchaseDemand';
import { createRebalanceSnapshot } from '../import/rebalanceSnapshot';
import { acceptedEconomicDiagnostics } from '../domain/rebalancing';
import { resolveQuantityPolicies } from './quantityPolicies';
import type {
  RebalanceIssue,
  SnapshotBuildResult,
  RebalanceProposal,
  SkuQuantityPolicy,
} from '../domain/rebalancing/types';
import { calculateDemand, priceDemandFromMinMax } from '../domain/demand';
import { getManualEditCount } from '../domain/orderWorkflow';
import { buildOrderProjection } from '../domain/orders';
import { buildSkuOrder } from '../domain/skuOrder';
import { changedOrderIds } from '../domain/rebalanceWorkflow';
import { collectPurchasingIssues } from '../domain/purchasingIssues';
import { resolveSupplierAssignments } from '../domain/supplierAssignments';
import type {
  Order,
  OrderProjection,
  PricedDemandLine,
  SupplierResolution,
  ValidationIssue,
} from '../domain/types';
import type { AppState } from './appStore';

export interface WorkflowOrder extends Order {
  reviewed: boolean;
  manualEditCount: number;
}

export interface WorkflowOrderProjection
  extends Omit<OrderProjection, 'orders'> {
  orders: WorkflowOrder[];
}

export interface DerivedState {
  compareSku: ReturnType<typeof buildSkuOrder>;
  quantityPolicies: SkuQuantityPolicy[];
  resolutions: SupplierResolution[];
  demand: PricedDemandLine[];
  originalDemand: PricedDemandLine[];
  purchaseDemand: PurchaseDemandLine[];
  snapshot: SnapshotBuildResult | null;
  proposal: RebalanceProposal | null;
  acceptedSummary: { transferCount: number; diagnostics: RebalanceIssue[] };
  projection: WorkflowOrderProjection;
}

const EMPTY_DERIVED_STATE: DerivedState = {
  compareSku: buildSkuOrder([]),
  quantityPolicies: [],
  resolutions: [],
  demand: [],
  originalDemand: [],
  purchaseDemand: [],
  snapshot: null,
  proposal: null,
  acceptedSummary: { transferCount: 0, diagnostics: [] },
  projection: { orders: [], unassigned: [] },
};

interface PurchasingBasis {
  data: Omit<DerivedState, 'proposal' | 'projection'>;
  supplierBySku: Map<string, string | null>;
  demandBySupplier: Map<string, PurchaseDemandLine[]>;
  dataIssues: ValidationIssue[];
}

interface CachedPurchasing {
  basis: PurchasingBasis;
  projection: OrderProjection;
  view?: DerivedState;
}

// Exact state keys keep restored or independently constructed states isolated.
const purchasingCache = new WeakMap<AppState, CachedPurchasing>();

function purchasingInputs(state: AppState) {
  return [
    state.minMax,
    state.suppliers,
    state.minMaxIssues,
    state.supplierIssues,
    state.supplierAssignments,
    state.settings,
    state.snapshotId,
    state.rebalance.registry,
    state.rebalance.policies,
    state.rebalance.accepted,
  ] as const;
}

function samePurchasingInputs(previous: AppState, next: AppState): boolean {
  const inputs = purchasingInputs(next);
  return purchasingInputs(previous).every(
    (input, index) => input === inputs[index],
  );
}

function buildPurchasingBasis(state: AppState): PurchasingBasis | null {
  if (!state.minMax || !state.supplierAssignments) return null;
  const skuCodes = state.minMax.skus.map((sku) => sku.code);
  const resolutions = resolveSupplierAssignments(
    state.supplierAssignments,
    skuCodes,
    state.suppliers?.history ?? [],
    state.catalog?.suppliers,
    new Map(state.catalog?.products.flatMap((product) => product.unit ? [[product.code, product.unit] as const] : []) ?? []),
  );
  const demand = priceDemandFromMinMax(
    calculateDemand(state.minMax),
    state.minMax.skus,
    resolutions,
  );
  const registry = state.rebalance.registry.length
    ? state.rebalance.registry
    : [...new Set(state.minMax.branchStocks.map((s) => s.branch))].map(
        (name) => ({ id: name, name, active: true, aliases: [] }),
      );
  const quantityPolicies = resolveQuantityPolicies(state);
  const snapshot = createRebalanceSnapshot({
    snapshotId: state.snapshotId,
    dataset: state.minMax,
    branchRegistry: registry,
    skuPolicies: quantityPolicies,
    sourceIssues: state.minMaxIssues,
  });
  const legacyIssues: RebalanceIssue[] = quantityPolicies
    .filter((p) => p.quantityStep !== 1)
    .map((p) => ({
      code: 'LEGACY_QUANTITY_POLICY',
      severity: 'ERROR',
      skuCode: p.skuCode,
      sourceRow: null,
      message:
        'Сохранены принятые дробные перемещения. Для нового расчёта целыми единицами сначала отмените принятие этого товара.',
    }));
  if (legacyIssues.length) {
    snapshot.issues.push(...legacyIssues);
    snapshot.snapshot.validationIssues = [
      ...(snapshot.snapshot.validationIssues ?? []),
      ...legacyIssues,
    ];
  }
  const purchaseDemand = buildPurchaseDemand(
    demand,
    state.rebalance.accepted,
    registry,
  );
  const demandBySupplier = new Map<string, PurchaseDemandLine[]>();
  for (const line of purchaseDemand) {
    if (line.selectedSupplier === null || line.purchaseQty <= 0) continue;
    const rows = demandBySupplier.get(line.selectedSupplier) ?? [];
    rows.push(line);
    demandBySupplier.set(line.selectedSupplier, rows);
  }
  return {
    data: {
      compareSku: buildSkuOrder(skuCodes),
      quantityPolicies,
      resolutions,
      demand,
      originalDemand: demand,
      purchaseDemand,
      snapshot,
      acceptedSummary: {
        transferCount: state.rebalance.accepted.length,
        diagnostics: acceptedEconomicDiagnostics(
          snapshot.snapshot,
          state.rebalance.accepted,
        ),
      },
    },
    supplierBySku: new Map(
      resolutions.map((resolution) => [
        resolution.skuCode,
        resolution.selectedSupplier,
      ]),
    ),
    demandBySupplier,
    dataIssues: collectPurchasingIssues(state.minMax, state.minMaxIssues),
  };
}

function purchasingProjection(state: AppState): CachedPurchasing | null {
  const cached = purchasingCache.get(state);
  if (cached) return cached;

  const basis = buildPurchasingBasis(state);
  if (!basis) return null;
  const projection = buildOrderProjection(
    basis.data.purchaseDemand,
    basis.data.resolutions,
    state.edits,
    state.settings,
    basis.dataIssues,
    basis.data.compareSku,
  );
  const result = { basis, projection };
  purchasingCache.set(state, result);
  return result;
}

/** Carry a session-owned calculation across metadata changes and publication. */
export function reusePurchasingProjection(
  previous: AppState,
  next: AppState,
): void {
  const cached = purchasingCache.get(previous);
  if (
    cached &&
    previous.edits === next.edits &&
    samePurchasingInputs(previous, next)
  ) {
    purchasingCache.set(next, {
      basis: cached.basis,
      projection: cached.projection,
    });
  }
}

/** Reuses the normal order builder within the only suppliers whose inputs changed. */
export function reconcileOrderQtyEdits(
  previous: AppState,
  next: AppState,
): AppState | null {
  if (!samePurchasingInputs(previous, next)) return null;
  const current = purchasingProjection(previous);
  if (!current) return null;
  const { basis, projection: before } = current;

  const byKey = (edits: AppState['edits']) =>
    new Map(edits.map((edit) => [`${edit.skuCode}\0${edit.branch}`, edit]));
  const beforeEdits = byKey(previous.edits);
  const afterEdits = byKey(next.edits);
  const suppliers = new Set<string>();
  for (const [key, edit] of new Map([...beforeEdits, ...afterEdits])) {
    const previousEdit = beforeEdits.get(key);
    const nextEdit = afterEdits.get(key);
    if (
      previousEdit?.qty === nextEdit?.qty &&
      previousEdit?.excluded === nextEdit?.excluded
    )
      continue;
    // A legacy composite key containing another delimiter can match multiple suppliers.
    if (key.indexOf('\0') !== key.lastIndexOf('\0')) return null;
    const supplier = basis.supplierBySku.get(edit.skuCode);
    if (supplier != null) suppliers.add(supplier);
  }

  const replacements = new Map<string, Order>();
  for (const supplier of suppliers) {
    const rows = basis.demandBySupplier.get(supplier);
    if (!rows) continue;
    const scoped = buildOrderProjection(
      rows,
      basis.data.resolutions,
      next.edits,
      next.settings,
      basis.dataIssues,
      basis.data.compareSku,
    );
    for (const order of scoped.orders) replacements.set(order.id, order);
  }
  // The report and suppliers are unchanged, so quantity edits cannot add or remove order IDs.
  const affected = changedOrderIds(
    before.orders.filter((order) => replacements.has(order.id)),
    [...replacements.values()],
  );
  const projection = {
    ...before,
    orders: before.orders.map((order) => replacements.get(order.id) ?? order),
  };
  const result = {
    ...next,
    reviewedOrderIds: next.reviewedOrderIds.filter((id) => !affected.has(id)),
    exportedOrderIds: next.exportedOrderIds.filter((id) => !affected.has(id)),
  };
  purchasingCache.set(result, { basis, projection });
  return result;
}

/** Builds the purchasing view, or an empty view until both reports are loaded. */
export function derive(state: AppState): DerivedState {
  const current = purchasingProjection(state);
  if (!current) return EMPTY_DERIVED_STATE;
  if (current.view) return current.view;

  const { basis, projection: baseProjection } = current;
  const exportedIds = new Set(state.exportedOrderIds ?? []);
  const reviewedIds = new Set(state.reviewedOrderIds ?? []);

  // EXPORTED/reviewed/manual-edit metadata is session/presentation state, not a
  // business recalculation. A blocker always wins over an old export marker.
  const orders: WorkflowOrder[] = baseProjection.orders.map((order) => ({
    ...order,
    status:
      exportedIds.has(order.id) && order.status === 'READY'
        ? ('EXPORTED' as const)
        : order.status,
    reviewed: reviewedIds.has(order.id),
    manualEditCount: getManualEditCount(order),
  }));

  const result: DerivedState = {
    ...basis.data,
    proposal: state.rebalance.proposal,
    projection: { ...baseProjection, orders },
  };
  current.view = result;
  return result;
}
