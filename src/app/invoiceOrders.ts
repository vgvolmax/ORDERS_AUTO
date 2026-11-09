import type { AppState } from './appStore';
import { derive, type WorkflowOrder } from './selectors';

export type InvoiceOrder = WorkflowOrder & { exported: boolean };

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
