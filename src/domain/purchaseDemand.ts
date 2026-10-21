import { calculateStockStatus } from './demand';
import { normalizeKey } from './normalize';
import type { PricedDemandLine, PurchaseDemandContext } from './types';
import { acceptedTotals } from './rebalancing/constraints';
import { subtractQuantity, sumQuantities } from './rebalancing/numbers';
import { RebalanceError, stockKey, type AcceptedTransfer, type BranchRegistry } from './rebalancing/types';

export interface PurchaseDemandLine extends PricedDemandLine, PurchaseDemandContext {}

/** Consumes the current snapshot's validated accepted ledger; it does not accept proposals. */
export function buildPurchaseDemand(demand: PricedDemandLine[], accepted: AcceptedTransfer[], branchRegistry: BranchRegistry): PurchaseDemandLine[] {
  const aliases = new Map<string, Set<string>>(), branchIds = new Set<string>();
  for (const b of branchRegistry) {
    if (!b.id || branchIds.has(b.id)) throw new RebalanceError('INVALID_SNAPSHOT');
    branchIds.add(b.id);
    for (const name of [b.name, ...b.aliases]) {
      const key = normalizeKey(name), ids = aliases.get(key) ?? new Set<string>(); ids.add(b.id); aliases.set(key, ids);
    }
  }
  const byKey = new Map<string, PricedDemandLine>();
  const keys = demand.map((line) => {
    const ids = [...(aliases.get(normalizeKey(line.branch)) ?? [])];
    if (ids.length !== 1) throw new RebalanceError('INVALID_SNAPSHOT');
    const key = stockKey(line.skuCode, ids[0]!);
    if (byKey.has(key)) throw new RebalanceError('INVALID_SNAPSHOT');
    byKey.set(key, line); return key;
  });
  const ids = new Set<string>(), sources = new Set<string>(), snapshots = new Set<string>();
  const transferIdsByKey = new Map<string, string[]>();
  for (const t of accepted) {
    const from = stockKey(t.skuCode, t.fromBranchId), to = stockKey(t.skuCode, t.toBranchId), source = JSON.stringify([t.sourceRunId, t.sourceLineId]);
    if (!t.transferId || ids.has(t.transferId) || sources.has(source) || !Number.isFinite(t.qty) || t.qty <= 0 || from === to || !byKey.has(from) || !byKey.has(to))
      throw new RebalanceError('INVALID_ACCEPTED_LEDGER');
    ids.add(t.transferId); sources.add(source); snapshots.add(t.snapshotId);
    for (const key of [from, to]) { const list = transferIdsByKey.get(key) ?? []; list.push(t.transferId); transferIdsByKey.set(key, list); }
  }
  if (snapshots.size > 1) throw new RebalanceError('INVALID_ACCEPTED_LEDGER');
  const totals = acceptedTotals(accepted);
  const rows = demand.map((line, i): PurchaseDemandLine => {
    const key = keys[i]!, incoming = totals.incoming.get(key) ?? 0, outgoing = totals.outgoing.get(key) ?? 0;
    const projectedStock = sumQuantities([line.stock, incoming, -outgoing]);
    if (incoming > 0 || outgoing > 0) {
      // Explicit zero norms permit donating surplus, while procurement keeps NO_NORM/zero need.
      const zeroNormDonor = line.min === 0 && line.max === 0 && incoming === 0;
      if (line.min === null || !Number.isFinite(line.min) || line.min < 0 || line.max === null || !Number.isFinite(line.max) || line.max < line.min ||
          line.status === 'INVALID_NORM' || (line.status === 'NO_NORM' && !zeroNormDonor) ||
          (outgoing > 0 && subtractQuantity(line.stock, outgoing) < line.max) || (incoming > 0 && projectedStock > line.max))
        throw new RebalanceError('INVALID_ACCEPTED_LEDGER');
    }
    const calculation = calculateStockStatus(projectedStock, line.min, line.max);
    const purchaseQty = calculation.deficitQty;
    return { ...line, originalNeed: line.deficitQty, acceptedIncomingQty: incoming, acceptedOutgoingQty: outgoing, projectedStock, purchaseQty,
      purchaseAmount: line.unitPrice === null ? null : purchaseQty * line.unitPrice, purchaseStatus: calculation.status,
      acceptedTransferIds: [...(transferIdsByKey.get(key) ?? [])].sort(), networkPurchaseQty: 0, networkPurchaseAmount: 0, networkPurchaseMissingPriceCount: 0 };
  });
  const networks = new Map<string, { quantities: number[]; amounts: number[]; missing: number }>();
  for (const line of rows) {
    const network = networks.get(line.skuCode) ?? { quantities: [], amounts: [], missing: 0 };
    network.quantities.push(line.purchaseQty);
    if (line.purchaseQty > 0) {
      if (line.purchaseAmount === null) network.missing++;
      else network.amounts.push(line.purchaseAmount);
    }
    networks.set(line.skuCode, network);
  }
  return rows.map((line) => {
    const network = networks.get(line.skuCode)!;
    return { ...line, networkPurchaseQty: sumQuantities(network.quantities), networkPurchaseAmount: sumQuantities(network.amounts), networkPurchaseMissingPriceCount: network.missing };
  });
}
