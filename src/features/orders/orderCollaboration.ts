import type { WorkspaceRebaseCheck } from '../../app/appStore';
import { derive } from '../../app/selectors';
import { changedOrderIds } from '../../domain/rebalanceWorkflow';
import type { OrderLine } from '../../domain/types';
import { WorkspaceConflictError } from '../../domain/workspace';

function lineSignature(line: OrderLine | undefined) {
  if (!line) return null;
  return JSON.stringify([
    line.orderQty, line.excluded, line.calculatedQty, line.unitPrice, line.unit, line.supplier,
    line.stock, line.min, line.max, line.purchaseContext?.acceptedTransferIds,
  ]);
}

export function checkOrderLines(orderIds: string[], skuCode: string): WorkspaceRebaseCheck {
  return (before, latest) => {
    const previous = new Map(derive(before).projection.orders.map((order) => [order.id, order]));
    const current = new Map(derive(latest).projection.orders.map((order) => [order.id, order]));
    for (const id of orderIds) {
      const oldLine = previous.get(id)?.lines.find((line) => line.skuCode === skuCode);
      const newLine = current.get(id)?.lines.find((line) => line.skuCode === skuCode);
      if (!newLine || !oldLine || lineSignature(oldLine) !== lineSignature(newLine))
        throw new WorkspaceConflictError(
          newLine
            ? `Коллега изменил позицию ${skuCode}. Текущее количество: ${newLine.orderQty}. Проверьте строку перед повторной правкой.`
            : `Позиция ${skuCode} изменилась или исчезла из заказа. Проверьте состав заказа.`,
          newLine?.orderQty,
        );
    }
  };
}

export function checkOrderReview(orderIds: string[], reviewed: boolean): WorkspaceRebaseCheck {
  const selected = new Set(orderIds);
  return (before, latest) => {
    if (!reviewed) return;
    const orders = (state: typeof before) =>
      derive(state).projection.orders.filter(({ id }) => selected.has(id));
    const current = orders(latest);
    if (current.length !== selected.size || changedOrderIds(orders(before), current).size)
      throw new WorkspaceConflictError('Коллега изменил состав заказа. Проверьте актуальные позиции перед подтверждением.');
  };
}
