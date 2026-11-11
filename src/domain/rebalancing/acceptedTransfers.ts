import { ALGORITHM_VERSION } from './calculate';
import {
  assertConfig,
  assertSnapshot,
  acceptedTotals,
  branchParticipationFingerprint,
  rebalanceConfigFingerprint,
  routeAllows,
  routeRules,
  validateAcceptedLedger,
} from './constraints';
import { receiverTarget, sumQuantities } from './numbers';
import { moneyProductsLessThan } from '../money';
import {
  getAmountExemptDonors,
  getTransferAmountFilter,
  groupTransferSkuAmounts,
  transferSkuKey,
} from './transferAmounts';
import { acceptedEconomicDiagnostics } from './economics';
import { assertTransferReservations } from './manualTransferQuantity';
import {
  RebalanceError,
  stockKey,
  type AcceptTransfersInput,
  type RevokeTransfersInput,
  type AcceptedTransferChange,
  type AcceptedTransfer,
  type RebalanceSnapshot,
} from './types';

function revision(current: number, expected: number): void {
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current !== expected ||
    current >= Number.MAX_SAFE_INTEGER
  )
    throw new RebalanceError('REVISION_CONFLICT');
}
function change(
  snapshot: RebalanceSnapshot,
  current: AcceptedTransfer[],
  next: AcceptedTransfer[],
  keys: string[],
  currentRevision: number,
): AcceptedTransferChange {
  const nextAccepted = keys.length ? next : current;
  return {
    nextAccepted,
    changedSkuBranchKeys: [...new Set(keys)].sort(),
    nextRevision: currentRevision + (keys.length ? 1 : 0),
    diagnostics: acceptedEconomicDiagnostics(snapshot, nextAccepted),
  };
}
const contextKeys = (t: AcceptedTransfer): string[] => [
  stockKey(t.skuCode, t.fromBranchId),
  stockKey(t.skuCode, t.toBranchId),
];
function assertLedger(input: {
  snapshot: AcceptTransfersInput['snapshot'];
  currentAccepted: AcceptedTransfer[];
}): void {
  assertSnapshot(input.snapshot);
  const issues = validateAcceptedLedger(input.snapshot, input.currentAccepted);
  if (issues.length)
    throw new RebalanceError('INVALID_ACCEPTED_LEDGER', issues);
}

export function acceptTransfers(
  input: AcceptTransfersInput,
): AcceptedTransferChange {
  revision(input.currentRevision, input.expectedRevision);
  assertLedger(input);
  const p = input.currentProposal;
  const review = input.operatorReview;
  const acceptedConfig = review?.config ?? p.config;
  if (
    p.snapshotId !== input.snapshot.snapshotId ||
    !p.runId ||
    p.baseAcceptedRevision > input.currentRevision
  )
    throw new RebalanceError('STALE_PROPOSAL');
  const proposalById = new Map(p.transfers.map((t) => [t.sourceLineId, t]));
  if (proposalById.size !== p.transfers.length)
    throw new RebalanceError('STALE_PROPOSAL');
  const rejected = new Set(review?.rejectedLineIds);
  const selected = [...new Set(input.selectedLineIds)].map((id) => {
    const line = proposalById.get(id);
    if (!line || rejected.has(id)) throw new RebalanceError('STALE_PROPOSAL');
    return line;
  });
  const existingBySource = new Map(
    input.currentAccepted.map((t) => [
      JSON.stringify([t.sourceRunId, t.sourceLineId]),
      t,
    ]),
  );
  const existingIds = new Set(input.currentAccepted.map((t) => t.transferId));
  const additions: AcceptedTransfer[] = [];
  for (const t of selected) {
    const existing = existingBySource.get(
      JSON.stringify([p.runId, t.sourceLineId]),
    );
    if (existing) {
      if (
        existing.skuCode !== t.skuCode ||
        existing.fromBranchId !== t.fromBranchId ||
        existing.toBranchId !== t.toBranchId ||
        existing.qty !== t.qty
      )
        throw new RebalanceError('TRANSFER_ID_CONFLICT');
      continue;
    }
    const id = input.transferIdBySourceLineId[t.sourceLineId];
    if (!id || existingIds.has(id))
      throw new RebalanceError('TRANSFER_ID_CONFLICT');
    existingIds.add(id);
    additions.push({
      transferId: id,
      sourceRunId: p.runId,
      sourceLineId: t.sourceLineId,
      skuCode: t.skuCode,
      fromBranchId: t.fromBranchId,
      toBranchId: t.toBranchId,
      qty: t.qty,
      ...(t.originalQty === undefined ? {} : { originalQty: t.originalQty }),
      ...(review ? { operatorReviewed: true as const } : {}),
      snapshotId: input.snapshot.snapshotId,
      acceptedAt: input.acceptedAt,
      acceptedConfig: structuredClone({
        ...acceptedConfig,
        transferAmountFilter: getTransferAmountFilter(acceptedConfig),
      }),
    });
  }
  if (!additions.length)
    return change(
      input.snapshot,
      input.currentAccepted,
      input.currentAccepted,
      [],
      input.currentRevision,
    );
  if (
    p.algorithmVersion !== ALGORITHM_VERSION ||
    p.participationFingerprint !==
      branchParticipationFingerprint(input.snapshot.branches)
  )
    throw new RebalanceError('STALE_PROPOSAL');
  const active = new Set(
    input.snapshot.branches.filter((b) => b.active).map((b) => b.id),
  );
  if (
    additions.some(
      (t) => !active.has(t.fromBranchId) || !active.has(t.toBranchId),
    )
  )
    throw new RebalanceError('INVALID_TRANSFER_BATCH');
  assertConfig(p.config);
  if (
    (!review && p.configFingerprint !== input.currentConfigFingerprint) ||
    p.configFingerprint !== rebalanceConfigFingerprint(p.config)
  )
    throw new RebalanceError('STALE_PROPOSAL');
  const eligible = new Set(p.eligibleRecipientKeys);
  if (additions.some((t) => !eligible.has(stockKey(t.skuCode, t.toBranchId))))
    throw new RebalanceError('INVALID_TRANSFER_BATCH');
  if (review) {
    assertConfig(acceptedConfig);
    const currentRules = routeRules(acceptedConfig);
    const originalRules = routeRules(p.config);
    if (additions.some((t) =>
      !routeAllows(acceptedConfig, t.fromBranchId, t.toBranchId, currentRules) ||
      !routeAllows(p.config, t.fromBranchId, t.toBranchId, originalRules),
    )) throw new RebalanceError('TRANSFER_ROUTE_UNAVAILABLE');
    assertTransferReservations({
      snapshot: input.snapshot, proposal: p, accepted: input.currentAccepted,
      rejectedLineIds: review.rejectedLineIds, config: acceptedConfig,
    }, additions);
  }
  const next = [...input.currentAccepted, ...additions];
  const issues = validateAcceptedLedger(input.snapshot, next);
  if (issues.length) throw new RebalanceError('INVALID_TRANSFER_BATCH', issues);
  if (!review) {
    const totals = acceptedTotals(next);
    const stocks = new Map(
      input.snapshot.stocks.map((s) => [stockKey(s.skuCode, s.branchId), s]),
    );
    for (const t of additions) {
      const key = stockKey(t.skuCode, t.toBranchId);
      const to = stocks.get(key)!;
      if (
        sumQuantities([to.stock, totals.incoming.get(key) ?? 0]) >
        receiverTarget(to.min!, to.max!, p.config.receiverPct)
      ) throw new RebalanceError('INVALID_TRANSFER_BATCH');
    }
  }
  const amountFilter = getTransferAmountFilter(acceptedConfig);
  if (amountFilter.enabled && acceptedConfig.stockAmountException?.enabled) {
    // Lines already accepted from this plan share the same starting stock.
    const earlier = input.currentAccepted.filter((t) => t.sourceRunId !== p.runId);
    const exemptDonors = getAmountExemptDonors(
      input.snapshot,
      acceptedConfig,
      acceptedTotals(earlier).outgoing,
    );
    for (const t of additions) {
      if (exemptDonors.has(stockKey(t.skuCode, t.fromBranchId)))
        t.amountExemptByStock = true;
    }
  }
  if (!review && amountFilter.enabled) {
    const changedRoutes = new Set(additions.map(transferSkuKey));
    const sameRun = next.filter(
      (t) => t.sourceRunId === p.runId && changedRoutes.has(transferSkuKey(t)),
    );
    for (const group of groupTransferSkuAmounts(
      input.snapshot,
      sameRun,
    ).values()) {
      if (
        !group.lines.every((t) => t.amountExemptByStock) &&
        (group.amount === null ||
          moneyProductsLessThan(group.products, amountFilter.threshold))
      )
        throw new RebalanceError('INVALID_TRANSFER_BATCH');
    }
  }
  return change(
    input.snapshot,
    input.currentAccepted,
    next,
    additions.flatMap(contextKeys),
    input.currentRevision,
  );
}

export function revokeTransfers(
  input: RevokeTransfersInput,
): AcceptedTransferChange {
  revision(input.currentRevision, input.expectedRevision);
  assertLedger(input);
  const ids = new Set(input.transferIds),
    removed = input.currentAccepted.filter((t) => ids.has(t.transferId));
  return change(
    input.snapshot,
    input.currentAccepted,
    input.currentAccepted.filter((t) => !ids.has(t.transferId)),
    removed.flatMap(contextKeys),
    input.currentRevision,
  );
}
