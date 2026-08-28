import { calculateDemand, priceDemand } from '../domain/demand';
import { buildOrderProjection } from '../domain/orders';
import { resolveSuppliers } from '../domain/suppliers';
import type {
  OrderProjection,
  PricedDemandLine,
  SupplierResolution,
} from '../domain/types';
import type { AppState } from './appStore';

export interface DerivedState {
  resolutions: SupplierResolution[];
  demand: PricedDemandLine[];
  projection: OrderProjection;
}

const EMPTY_DERIVED_STATE: DerivedState = {
  resolutions: [],
  demand: [],
  projection: { orders: [], unassigned: [] },
};

// AppState is replaced immutably by React setState. A WeakMap therefore lets
// local component state (search/filter text) re-render without rebuilding the
// full demand/supplier/order graph, while old snapshots remain collectable.
const derivedCache = new WeakMap<AppState, DerivedState>();

/**
 * Builds every computed purchasing projection from normalized application state.
 *
 * The selector is intentionally total: before both reports are loaded it returns
 * an empty projection rather than `null`. This keeps presentation components free
 * from non-null assertions and, more importantly, centralizes the rule that no
 * business calculation may run on a half-imported data set.
 */
export function derive(state: AppState): DerivedState {
  const cached = derivedCache.get(state);
  if (cached) {
    return cached;
  }

  if (!state.minMax || !state.suppliers) {
    derivedCache.set(state, EMPTY_DERIVED_STATE);
    return EMPTY_DERIVED_STATE;
  }

  const resolutions = resolveSuppliers(
    state.suppliers.history,
    state.overrides,
    state.minMax.skus.map((sku) => sku.code),
  );
  const demand = priceDemand(
    calculateDemand(state.minMax),
    state.minMax.skus,
    resolutions,
  );
  const baseProjection = buildOrderProjection(
    demand,
    resolutions,
    state.edits,
    state.settings,
  );
  const exportedIds = new Set(state.exportedOrderIds ?? []);

  // EXPORTED is session state, not a business recalculation. If an order later
  // becomes blocked, the blocker always wins over its previous export marker.
  const orders = baseProjection.orders.map((order) =>
    exportedIds.has(order.id) && order.status === 'READY'
      ? { ...order, status: 'EXPORTED' as const }
      : order,
  );

  const result: DerivedState = {
    resolutions,
    demand,
    projection: { ...baseProjection, orders },
  };
  derivedCache.set(state, result);
  return result;
}
