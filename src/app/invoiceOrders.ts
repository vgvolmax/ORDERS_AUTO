import type { AppState } from './appStore';
import { attachSupplierCatalog } from './catalogSession';
import { derive, type WorkflowOrder } from './selectors';

export type InvoiceOrder = WorkflowOrder & { exported: boolean; archivedBasis?: 'export' | 'session' };

export function canReconcileOrder(order: WorkflowOrder, exported: boolean): boolean {
  return (
    (order.reviewed || exported) &&
    order.lines.some((line) => line.orderQty > 0) &&
    order.blockers.every((reason) =>
      reason === 'Ниже минимальной суммы' || reason === 'Не хватает цены',
    )
  );
}

export function selectInvoiceOrders(state: AppState): InvoiceOrder[] {
  const exportedIds = new Set(state.exportedOrderIds);
  return derive(state).projection.orders.flatMap((order) => {
    const exported = exportedIds.has(order.id);
    return canReconcileOrder(order, exported) ? [{ ...order, exported }] : [];
  });
}

export function selectArchivedInvoiceOrders(state: AppState, catalog: AppState['catalog']): InvoiceOrder[] {
  const recorded = new Map<string, InvoiceOrder>();
  for (const order of state.exportedOrders ?? []) {
    recorded.set(order.id, { ...order, status: 'EXPORTED', reviewed: false, manualEditCount: 0,
      exported: true, archivedBasis: 'export' });
  }
  if (state.exportedOrderIds.some((id) => !recorded.has(id))) {
    for (const order of selectInvoiceOrders(state)) {
      if (order.exported && !recorded.has(order.id)) recorded.set(order.id, { ...order, archivedBasis: 'session' });
    }
  }
  const current = selectInvoiceOrders(attachSupplierCatalog(state, catalog));
  return [...recorded.values(), ...current.filter((order) => !recorded.has(order.id))];
}
