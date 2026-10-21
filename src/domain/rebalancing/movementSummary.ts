import type { PurchaseDemandLine } from '../purchaseDemand';
import { normalizeKey } from '../normalize';
import { sumQuantities } from './numbers';
import type { AcceptedTransfer, BranchRegistry, SkuQuantityPolicy } from './types';
export interface MovementScope { skuCode?: string; branchId?: string; branch?: string; orderIds?: string[] }
export interface MovementSummaryInput { purchaseDemand: PurchaseDemandLine[]; acceptedTransfers: AcceptedTransfer[]; registry: BranchRegistry; policies: SkuQuantityPolicy[]; scope: MovementScope; manualOrderQty?: number | undefined }
export interface MovementTotals { unit: string | null; skuCode?: string; originalNeed: number; currentNeed: number; incomingQty: number; outgoingQty: number }
export interface MovementSummary {
  originalNeed: number | null; currentNeed: number | null; incomingQty: number | null; outgoingQty: number | null; transferCount: number;
  totalsByUnit: MovementTotals[]; transfers: (AcceptedTransfer & { fromName: string; toName: string; unit: string | null })[];
  stocks: { skuCode: string; branch: string; physical: number; projected: number }[]; manualOrderQty?: number | undefined;
}
export function buildMovementSummary(input: MovementSummaryInput): MovementSummary {
  const { scope, registry } = input, units = new Map(input.policies.map((p) => [p.skuCode, p.unit]));
  const branch = scope.branchId ? registry.find((b) => b.id === scope.branchId) : undefined;
  const branchNames = branch ? [branch.name, ...branch.aliases].map(normalizeKey) : scope.branch ? [normalizeKey(scope.branch)] : null;
  const rows = input.purchaseDemand.filter((l) => (!scope.skuCode || l.skuCode === scope.skuCode) && (!scope.branchId || branch) && (!branchNames || branchNames.includes(normalizeKey(l.branch))) && (!scope.orderIds || scope.orderIds.includes(`${l.branch}\0${l.selectedSupplier}`)));
  const groups = new Map<string, PurchaseDemandLine[]>();
  for (const l of rows) { const key = units.get(l.skuCode) ?? `unknown:${l.skuCode}`; const group = groups.get(key) ?? []; group.push(l); groups.set(key, group); }
  const totalsByUnit = [...groups.values()].map((lines): MovementTotals => ({ unit: units.get(lines[0]!.skuCode) ?? null, ...(units.has(lines[0]!.skuCode) ? {} : { skuCode: lines[0]!.skuCode }), originalNeed: sumQuantities(lines.map((l) => l.originalNeed)), currentNeed: sumQuantities(lines.map((l) => l.purchaseQty)), incomingQty: sumQuantities(lines.map((l) => l.acceptedIncomingQty)), outgoingQty: sumQuantities(lines.map((l) => l.acceptedOutgoingQty)) }));
  const ids = new Set(rows.flatMap((l) => l.acceptedTransferIds));
  const transfers = [...new Map(input.acceptedTransfers.filter((t) => ids.has(t.transferId)).map((t) => [t.transferId, t])).values()].map((t) => ({ ...t, fromName: registry.find((b) => b.id === t.fromBranchId)?.name ?? t.fromBranchId, toName: registry.find((b) => b.id === t.toBranchId)?.name ?? t.toBranchId, unit: units.get(t.skuCode) ?? null }));
  return { originalNeed: totalsByUnit.length === 1 ? totalsByUnit[0]!.originalNeed : null, currentNeed: totalsByUnit.length === 1 ? totalsByUnit[0]!.currentNeed : null, incomingQty: totalsByUnit.length === 1 ? totalsByUnit[0]!.incomingQty : null, outgoingQty: totalsByUnit.length === 1 ? totalsByUnit[0]!.outgoingQty : null, totalsByUnit, transferCount: transfers.length, transfers, stocks: rows.filter((l) => l.acceptedTransferIds.length).map((l) => ({ skuCode: l.skuCode, branch: l.branch, physical: l.stock, projected: l.projectedStock })), manualOrderQty: input.manualOrderQty };
}
