import type { Order, OrderQtyEdit } from './types';

interface ApplyOrderQtyChangeInput {
  edits: OrderQtyEdit[];
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
  order: Order;
  skuCode: string;
  qty: number;
}

interface ApplyOrderQtyChangeResult {
  edits: OrderQtyEdit[];
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
}

export function applyOrderQtyChange({
  edits,
  reviewedOrderIds,
  exportedOrderIds,
  order,
  skuCode,
  qty,
}: ApplyOrderQtyChangeInput): ApplyOrderQtyChangeResult {
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error('Количество не может быть отрицательным или нечисловым');
  }

  const line = order.lines.find((item) => item.skuCode === skuCode);
  if (!line) {
    throw new Error(`Позиция ${skuCode} отсутствует в заказе ${order.id}`);
  }

  if (qty === line.orderQty) {
    return { edits, reviewedOrderIds, exportedOrderIds };
  }

  const withoutCurrentEdit = edits.filter(
    (edit) => edit.skuCode !== skuCode || edit.branch !== order.branch,
  );
  const nextEdits =
    qty === line.calculatedQty
      ? withoutCurrentEdit
      : [...withoutCurrentEdit, { skuCode, branch: order.branch, qty }];

  return {
    edits: nextEdits,
    reviewedOrderIds: reviewedOrderIds.filter((id) => id !== order.id),
    exportedOrderIds: exportedOrderIds.filter((id) => id !== order.id),
  };
}

export function getManualEditCount(order: Order): number {
  return order.lines.filter((line) => line.orderQty !== line.calculatedQty).length;
}

export function setOrderReviewed(
  reviewedOrderIds: string[],
  orderId: string,
  reviewed: boolean,
): string[] {
  if (reviewed) {
    return [...new Set([...reviewedOrderIds, orderId])];
  }
  return reviewedOrderIds.filter((id) => id !== orderId);
}

export function setOrdersReviewed(
  reviewedOrderIds: string[],
  orderIds: Iterable<string>,
  reviewed: boolean,
): string[] {
  const targetIds = new Set(orderIds);
  if (reviewed) {
    return [...new Set([...reviewedOrderIds, ...targetIds])];
  }
  return reviewedOrderIds.filter((id) => !targetIds.has(id));
}
