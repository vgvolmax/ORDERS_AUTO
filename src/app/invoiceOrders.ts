import type { AppState } from './appStore';
import { attachSupplierCatalog } from './catalogSession';
import { derive, type WorkflowOrder } from './selectors';

export type InvoiceOrder = WorkflowOrder & { exported: boolean; archivedBasis?: 'export' | 'session' };

export type InvoiceOrderBasis = 'preferred' | 'current';

export function canReconcileOrder(order: WorkflowOrder, exported: boolean): boolean {
  return (
    (order.reviewed || exported) &&
    order.lines.some((line) => line.orderQty > 0) &&
    order.blockers.every((reason) =>
      reason === 'Ниже минимальной суммы' || reason === 'Не хватает цены',
    )
  );
}

function recordedInvoiceOrders(state: AppState): InvoiceOrder[] {
  return (state.exportedOrders ?? []).map((order) => ({
    ...order, status: 'EXPORTED', reviewed: false, manualEditCount: 0,
    exported: true, archivedBasis: 'export',
  }));
}

export function selectInvoiceOrders(state: AppState, basis: InvoiceOrderBasis = 'preferred'): InvoiceOrder[] {
  const exportedIds = new Set(state.exportedOrderIds);
  const live = derive(state).projection.orders.flatMap((order) => {
    const exported = exportedIds.has(order.id);
    return canReconcileOrder(order, exported) ? [{ ...order, exported }] : [];
  });
  if (basis === 'current') return live;
  const liveIds = new Set(live.map(({ id }) => id));
  const recorded = new Map(recordedInvoiceOrders(state).map((order) => [order.id, order]));
  return [
    ...live.map((order) => recorded.get(order.id) ?? order),
    ...[...recorded.values()].filter((order) => !liveIds.has(order.id)),
  ];
}

export function selectArchivedInvoiceOrders(state: AppState, catalog: AppState['catalog']): InvoiceOrder[] {
  const recorded = new Map<string, InvoiceOrder>();
  for (const order of recordedInvoiceOrders(state)) recorded.set(order.id, order);
  if (state.exportedOrderIds.some((id) => !recorded.has(id))) {
    for (const order of selectInvoiceOrders(state, 'current')) {
      if (order.exported && !recorded.has(order.id)) recorded.set(order.id, { ...order, archivedBasis: 'session' });
    }
  }
  const current = selectInvoiceOrders(attachSupplierCatalog(state, catalog), 'current');
  return [...recorded.values(), ...current.filter((order) => !recorded.has(order.id))];
}
