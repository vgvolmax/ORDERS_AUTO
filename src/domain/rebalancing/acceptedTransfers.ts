import { assertConfig, assertSnapshot, acceptedTotals, rebalanceConfigFingerprint, validateAcceptedLedger } from './constraints';
import { moneyGreaterThan, receiverTarget, sumQuantities } from './numbers';
import { RebalanceError, stockKey, type AcceptTransfersInput, type RevokeTransfersInput, type AcceptedTransferChange, type AcceptedTransfer } from './types';

function revision(current: number, expected: number): void {
  if (!Number.isSafeInteger(current) || current < 0 || current !== expected || current >= Number.MAX_SAFE_INTEGER) throw new RebalanceError('REVISION_CONFLICT');
}
function change(current: AcceptedTransfer[], next: AcceptedTransfer[], keys: string[], currentRevision: number): AcceptedTransferChange {
  return { nextAccepted: keys.length ? next : current, changedSkuBranchKeys: [...new Set(keys)].sort(), nextRevision: currentRevision + (keys.length ? 1 : 0) };
}
const contextKeys = (t: AcceptedTransfer): string[] => [stockKey(t.skuCode, t.fromBranchId), stockKey(t.skuCode, t.toBranchId)];
function assertLedger(input: { snapshot: AcceptTransfersInput['snapshot']; currentAccepted: AcceptedTransfer[] }): void {
  assertSnapshot(input.snapshot);
  const issues = validateAcceptedLedger(input.snapshot, input.currentAccepted);
  if (issues.length) throw new RebalanceError('INVALID_ACCEPTED_LEDGER', issues);
}

export function acceptTransfers(input: AcceptTransfersInput): AcceptedTransferChange {
  revision(input.currentRevision, input.expectedRevision); assertLedger(input);
  const p = input.currentProposal;
  if (p.snapshotId !== input.snapshot.snapshotId || !p.runId || p.baseAcceptedRevision > input.currentRevision)
    throw new RebalanceError('STALE_PROPOSAL');
  const proposalById = new Map(p.transfers.map((t) => [t.sourceLineId, t]));
  if (proposalById.size !== p.transfers.length) throw new RebalanceError('STALE_PROPOSAL');
  const selected = [...new Set(input.selectedLineIds)].map((id) => {
    const line = proposalById.get(id); if (!line) throw new RebalanceError('STALE_PROPOSAL'); return line;
  });
  const existingBySource = new Map(input.currentAccepted.map((t) => [JSON.stringify([t.sourceRunId, t.sourceLineId]), t]));
  const existingIds = new Set(input.currentAccepted.map((t) => t.transferId));
  const additions: AcceptedTransfer[] = [];
  for (const t of selected) {
    const existing = existingBySource.get(JSON.stringify([p.runId, t.sourceLineId]));
    if (existing) {
      if (existing.skuCode !== t.skuCode || existing.fromBranchId !== t.fromBranchId || existing.toBranchId !== t.toBranchId || existing.qty !== t.qty)
        throw new RebalanceError('TRANSFER_ID_CONFLICT');
      continue;
    }
    const id = input.transferIdBySourceLineId[t.sourceLineId];
    if (!id || existingIds.has(id)) throw new RebalanceError('TRANSFER_ID_CONFLICT');
    existingIds.add(id);
    additions.push({ transferId: id, sourceRunId: p.runId, sourceLineId: t.sourceLineId, skuCode: t.skuCode, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId, qty: t.qty,
      snapshotId: input.snapshot.snapshotId, acceptedAt: input.acceptedAt, acceptedConfig: structuredClone(p.config) });
  }
  if (!additions.length) return change(input.currentAccepted, input.currentAccepted, [], input.currentRevision);
  assertConfig(p.config);
  if (p.configFingerprint !== input.currentConfigFingerprint || p.configFingerprint !== rebalanceConfigFingerprint(p.config)) throw new RebalanceError('STALE_PROPOSAL');
  const eligible = new Set(p.eligibleRecipientKeys);
  if (additions.some((t) => !eligible.has(stockKey(t.skuCode, t.toBranchId)))) throw new RebalanceError('INVALID_TRANSFER_BATCH');
  const next = [...input.currentAccepted, ...additions];
  const issues = validateAcceptedLedger(input.snapshot, next);
  if (issues.length) throw new RebalanceError('INVALID_TRANSFER_BATCH', issues);
  const totals = acceptedTotals(next), skus = new Map(input.snapshot.skus.map((s) => [s.skuCode, s]));
  const stocks = new Map(input.snapshot.stocks.map((s) => [stockKey(s.skuCode, s.branchId), s]));
  const addedSkus = new Set(additions.map((t) => t.skuCode));
  for (const t of additions) {
    const sku = skus.get(t.skuCode)!, key = stockKey(t.skuCode, t.toBranchId), to = stocks.get(key)!;
    if (sumQuantities([to.stock, totals.incoming.get(key) ?? 0]) > receiverTarget(to.min!, to.max!, p.config.receiverPct, sku.quantityStep!)) throw new RebalanceError('INVALID_TRANSFER_BATCH');
  }
  for (const code of addedSkus) {
    const price = skus.get(code)!.referencePrice;
    if (p.config.unitPriceFilter.enabled || p.config.skuAmountFilter.enabled) {
      if (price === null || !Number.isFinite(price) || price < 0) throw new RebalanceError('INVALID_TRANSFER_BATCH');
      if (p.config.unitPriceFilter.enabled && !moneyGreaterThan(1, price, p.config.unitPriceFilter.threshold)) throw new RebalanceError('INVALID_TRANSFER_BATCH');
      const runQty = sumQuantities(next.filter((t) => t.sourceRunId === p.runId && t.skuCode === code).map((t) => t.qty));
      if (p.config.skuAmountFilter.enabled && !moneyGreaterThan(runQty, price, p.config.skuAmountFilter.threshold)) throw new RebalanceError('INVALID_TRANSFER_BATCH');
    }
  }
  return change(input.currentAccepted, next, additions.flatMap(contextKeys), input.currentRevision);
}

export function revokeTransfers(input: RevokeTransfersInput): AcceptedTransferChange {
  revision(input.currentRevision, input.expectedRevision); assertLedger(input);
  const ids = new Set(input.transferIds), removed = input.currentAccepted.filter((t) => ids.has(t.transferId));
  return change(input.currentAccepted, input.currentAccepted.filter((t) => !ids.has(t.transferId)), removed.flatMap(contextKeys), input.currentRevision);
}
