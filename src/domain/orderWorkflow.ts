import type { Order, OrderQtyEdit } from './types';

interface OrderEditState {
  edits: OrderQtyEdit[];
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
}

interface ApplyOrderQtyChangeInput extends OrderEditState {
  order: Order;
  skuCode: string;
  qty: number;
}

interface ApplyOrderSkuExclusionInput extends OrderEditState {
  orders: readonly Order[];
  skuCode: string;
  excluded: boolean;
}

export function applyOrderQtyChange({
  edits,
  reviewedOrderIds,
  exportedOrderIds,
  order,
  skuCode,
  qty,
}: ApplyOrderQtyChangeInput): OrderEditState {
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error('Количество не может быть отрицательным или нечисловым');
  }

  const line = order.lines.find((item) => item.skuCode === skuCode);
  if (!line) {
    throw new Error(`Позиция ${skuCode} отсутствует в заказе ${order.id}`);
  }

  if (line.excluded || qty === line.orderQty) {
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

export function applyOrderSkuExclusion({
  edits,
  reviewedOrderIds,
  exportedOrderIds,
  orders,
  skuCode,
  excluded,
}: ApplyOrderSkuExclusionInput): OrderEditState {
  const changedBranches = new Set<string>();
  const changedOrderIds = new Set<string>();
  for (const order of orders) {
    const line = order.lines.find((item) => item.skuCode === skuCode);
    if (!line || Boolean(line.excluded) === excluded) continue;
    changedBranches.add(order.branch);
    changedOrderIds.add(order.id);
  }
  if (!changedBranches.size) return { edits, reviewedOrderIds, exportedOrderIds };

  const nextEdits = edits.filter(
    (edit) => edit.skuCode !== skuCode || !changedBranches.has(edit.branch),
  );
  if (excluded) {
    for (const branch of changedBranches)
      nextEdits.push({ skuCode, branch, qty: 0, excluded: true });
  }

  return {
    edits: nextEdits,
    reviewedOrderIds: reviewedOrderIds.filter((id) => !changedOrderIds.has(id)),
    exportedOrderIds: exportedOrderIds.filter((id) => !changedOrderIds.has(id)),
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
