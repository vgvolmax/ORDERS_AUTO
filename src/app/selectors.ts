import { calculateDemand, priceDemand } from '../domain/demand';
import { buildOrderProjection } from '../domain/orders';
import { resolveSuppliers } from '../domain/suppliers';
import type { OrderProjection, PricedDemandLine, SupplierResolution } from '../domain/types';
import type { AppState } from './appStore';

export interface DerivedState {
  resolutions: SupplierResolution[];
  demand: PricedDemandLine[];
  projection: OrderProjection;
}

export function derive(state: AppState): DerivedState | null {
  if (!state.minMax || !state.suppliers) {
    return null;
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

  return {
    resolutions,
    demand,
    projection: { ...baseProjection, orders },
  };
}
