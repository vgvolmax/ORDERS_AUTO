import { buildOrderProjection } from './orders';
import type { PurchaseDemandLine } from './purchaseDemand';
import type {
  Order,
  OrderProjection,
  OrderQtyEdit,
  OrderSettings,
  SupplierResolution,
} from './types';
export interface AcceptedWorkflowInput {
  previousDemand: PurchaseDemandLine[];
  nextDemand: PurchaseDemandLine[];
  previousProjection: OrderProjection;
  resolutions: SupplierResolution[];
  settings: OrderSettings;
  edits: OrderQtyEdit[];
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
}
export interface AcceptedWorkflowResult {
  edits: OrderQtyEdit[];
  reviewedOrderIds: string[];
  exportedOrderIds: string[];
  affectedOrderIds: string[];
  clearedEditCount: number;
}
const key = (sku: string, branch: string) => JSON.stringify([sku, branch]);
function signature(order: Order | undefined): string {
  if (!order) return '';
  return JSON.stringify([
    order.totalQty,
    order.totalAmount,
    order.belowThreshold,
    order.status === 'EXPORTED' ? 'READY' : order.status,
    order.blockers,
    order.lines
      .map((l) => [
        l.skuCode,
        l.calculatedQty,
        l.orderQty,
        l.unitPrice,
        l.amount,
        l.purchaseContext?.acceptedTransferIds,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}
export function buildAcceptedTransferStatePatch(
  input: AcceptedWorkflowInput,
): AcceptedWorkflowResult {
  const old = new Map(
    input.previousDemand.map((d) => [key(d.skuCode, d.branch), d.purchaseQty]),
  );
  const next = new Map(
    input.nextDemand.map((d) => [key(d.skuCode, d.branch), d.purchaseQty]),
  );
  const changed = new Set(
    [...old.keys(), ...next.keys()].filter(
      (k) => (old.get(k) ?? 0) !== (next.get(k) ?? 0),
    ),
  );
  const edits = input.edits.filter(
    (e) => !changed.has(key(e.skuCode, e.branch)),
  );
  const after = buildOrderProjection(
    input.nextDemand,
    input.resolutions,
    edits,
    input.settings,
  );
  const beforeById = new Map(
      input.previousProjection.orders.map((o) => [o.id, o]),
    ),
    afterById = new Map(after.orders.map((o) => [o.id, o]));
  const affected = new Set(
    [...beforeById.keys(), ...afterById.keys()].filter(
      (id) => signature(beforeById.get(id)) !== signature(afterById.get(id)),
    ),
  );
  return {
    edits,
    reviewedOrderIds: input.reviewedOrderIds.filter((id) => !affected.has(id)),
    exportedOrderIds: input.exportedOrderIds.filter((id) => !affected.has(id)),
    affectedOrderIds: [...affected].sort(),
    clearedEditCount: input.edits.length - edits.length,
  };
}
