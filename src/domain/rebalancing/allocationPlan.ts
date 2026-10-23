import {
  acceptedTotals,
  assertConfig,
  rebalanceConfigFingerprint,
  routeAllows,
  validateAcceptedLedger,
} from './constraints';
import { allocateFlow } from './flow';
import {
  isStepQuantity,
  moneyGreaterThan,
  quantityFromUnits,
  receiverTarget,
  stepUnits,
  sumQuantities,
} from './numbers';
import { buildRouteIndex } from './routes';
import { splitAllocation } from './allocationSplit';
import { validatedSnapshot } from './validation';
import {
  RebalanceError,
  stockKey,
  type AcceptedTransfer,
  type DonorAllocationDecision,
  type DonorSplitMode,
  type RebalanceProposal,
  type RebalanceSnapshot,
  type RebalanceTransfer,
} from './types';

export interface AllocationContext {
  snapshot: RebalanceSnapshot;
  proposal: RebalanceProposal;
  accepted: AcceptedTransfer[];
  rejectedLineIds?: readonly string[];
}
const sourceKey = (sku: string, from: string, to: string) =>
  JSON.stringify([sku, from, to]);
const groupKey = (sku: string, from: string) => stockKey(sku, from);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (): never => {
  throw new RebalanceError('INVALID_TRANSFER_BATCH');
};
function prepare(ctx: AllocationContext) {
  const p = ctx.proposal;
  assertConfig(p.config);
  if (
    p.snapshotId !== ctx.snapshot.snapshotId ||
    p.configFingerprint !== rebalanceConfigFingerprint(p.config)
  )
    throw new RebalanceError('STALE_PROPOSAL');
  const s = validatedSnapshot(ctx.snapshot).snapshot;
  const issues = validateAcceptedLedger(s, ctx.accepted);
  if (issues.length)
    throw new RebalanceError('INVALID_ACCEPTED_LEDGER', issues);
  const totals = acceptedTotals(ctx.accepted);
  const eligible = new Set(p.eligibleRecipientKeys);
  const acceptedBySource = new Map(
    ctx.accepted
      .filter((t) => t.sourceRunId === p.runId)
      .map((t) => [t.sourceLineId, t]),
  );
  const pending = p.transfers.filter(
    (t) => !acceptedBySource.has(t.sourceLineId),
  );
  const skus = new Map(s.skus.map((r) => [r.skuCode, r]));
  const blockedSkus = new Set(
    p.exclusions
      .filter((e) =>
        ['SKU_AMOUNT_FILTER', 'UNSAFE_QUANTITY_CAPACITY'].includes(e.code),
      )
      .map((e) => e.skuCode),
  );
  const allowedSku = (code: string) => {
    const sku = skus.get(code);
    if (!sku) return false;
    if (blockedSkus.has(code)) return false;
    if (
      (p.config.unitPriceFilter.enabled || p.config.skuAmountFilter.enabled) &&
      sku.referencePrice === null
    )
      return false;
    return (
      !p.config.unitPriceFilter.enabled ||
      moneyGreaterThan(
        1,
        sku.referencePrice!,
        p.config.unitPriceFilter.threshold,
      )
    );
  };
  return { s, p, totals, eligible, acceptedBySource, pending, allowedSku };
}

export interface DonorAllocationCell {
  toBranchId: string;
  name: string;
  stock: number;
  min: number;
  max: number;
  target: number;
  need: number;
  needToMax: number;
  otherPlanned: number;
  otherPlannedRejected: number;
  rejectedQty: number;
  acceptedIncoming: number;
  qty: number;
  acceptedQty: number;
  priority: boolean;
  locked: boolean;
  canAllocate: boolean;
  sourceLineId: string;
}
export interface DonorAllocationRow {
  skuCode: string;
  name: string;
  unit: string;
  step: number;
  fromBranchId: string;
  stock: number;
  max: number;
  acceptedOutgoing: number;
  availableQty: number;
  plannedQty: number;
  after: number;
  decisionMode: 'PRIORITY' | 'MANUAL' | 'AUTO';
  priorityRequired: boolean;
  cells: DonorAllocationCell[];
}
export function buildDonorAllocationModel(
  ctx: AllocationContext,
): DonorAllocationRow[] {
  const { s, p, totals, eligible, acceptedBySource, pending, allowedSku } =
    prepare(ctx);
  const names = new Map(s.branches.map((b) => [b.id, b.name]));
  const pendingTotals = acceptedTotals(pending);
  const rejectedSources = new Set(ctx.rejectedLineIds);
  const rejectedTotals = acceptedTotals(
    pending.filter((t) => rejectedSources.has(t.sourceLineId)),
  );
  const pendingBySource = new Map(pending.map((t) => [t.sourceLineId, t]));
  const stocksBySku = new Map<string, typeof s.stocks>();
  for (const stock of s.stocks) {
    const group = stocksBySku.get(stock.skuCode) ?? [];
    group.push(stock);
    stocksBySku.set(stock.skuCode, group);
  }
  const rows: DonorAllocationRow[] = [];
  for (const sku of s.skus) {
    if (!allowedSku(sku.skuCode)) continue;
    const stocks = stocksBySku.get(sku.skuCode) ?? [];
    for (const donor of stocks) {
      const key = stockKey(sku.skuCode, donor.branchId),
        acceptedOutgoing = totals.outgoing.get(key) ?? 0;
      if (donor.stock <= donor.max!) continue;
      const availableQty = quantityFromUnits(
        stepUnits(
          Math.max(
            0,
            sumQuantities([donor.stock, -donor.max!, -acceptedOutgoing]),
          ),
          sku.quantityStep!,
        ),
        sku.quantityStep!,
      );
      const decision = p.allocationDecisions?.find(
        (d) => d.skuCode === sku.skuCode && d.fromBranchId === donor.branchId,
      );
      const cells = stocks
        .filter(
          (r) =>
            eligible.has(stockKey(sku.skuCode, r.branchId)) &&
            routeAllows(p.config, donor.branchId, r.branchId),
        )
        .map((r): DonorAllocationCell => {
          const target = receiverTarget(r.min!, r.max!, p.config.receiverPct),
            receiverKey = stockKey(r.skuCode, r.branchId);
          const sourceLineId = sourceKey(
            sku.skuCode,
            donor.branchId,
            r.branchId,
          );
          const qty = pendingBySource.get(sourceLineId)?.qty ?? 0;
          const acceptedQty = acceptedBySource.get(sourceLineId)?.qty ?? 0;
          const acceptedIncoming = totals.incoming.get(receiverKey) ?? 0;
          const need = quantityFromUnits(
            stepUnits(
              Math.max(0, sumQuantities([target, -r.stock, -acceptedIncoming])),
              sku.quantityStep!,
            ),
            sku.quantityStep!,
          );
          return {
            toBranchId: r.branchId,
            name: names.get(r.branchId) ?? r.branchId,
            stock: r.stock,
            min: r.min!,
            max: r.max!,
            target,
            need,
            needToMax: quantityFromUnits(
              stepUnits(
                Math.max(
                  0,
                  sumQuantities([r.max!, -r.stock, -acceptedIncoming]),
                ),
                sku.quantityStep!,
              ),
              sku.quantityStep!,
            ),
            rejectedQty: rejectedSources.has(sourceLineId) ? qty : 0,
            otherPlannedRejected: sumQuantities([
              rejectedTotals.incoming.get(receiverKey) ?? 0,
              -(rejectedSources.has(sourceLineId) ? qty : 0),
            ]),
            otherPlanned: sumQuantities([
              pendingTotals.incoming.get(receiverKey) ?? 0,
              -qty,
            ]),
            acceptedIncoming,
            qty,
            acceptedQty,
            priority: decision?.recipientIds.includes(r.branchId) ?? false,
            locked: acceptedQty > 0,
            canAllocate: acceptedQty === 0 && need > 0,
            sourceLineId,
          };
        })
        .sort((a, b) => compare(a.toBranchId, b.toBranchId));
      if (!cells.length) continue;
      const remaining = cells
        .filter((c) => c.canAllocate)
        .map((c) => Math.max(0, sumQuantities([c.need, -c.otherPlanned])))
        .filter((n) => n > 0);
      const plannedQty = sumQuantities(cells.map((c) => c.qty));
      rows.push({
        skuCode: sku.skuCode,
        name: sku.name,
        unit: sku.unit!,
        step: sku.quantityStep!,
        fromBranchId: donor.branchId,
        stock: donor.stock,
        max: donor.max!,
        acceptedOutgoing,
        availableQty,
        plannedQty,
        after: sumQuantities([donor.stock, -acceptedOutgoing, -plannedQty]),
        decisionMode: decision?.mode ?? 'AUTO',
        priorityRequired:
          !decision &&
          remaining.length > 1 &&
          sumQuantities(remaining) > availableQty,
        cells,
      });
    }
  }
  return rows.sort((a, b) =>
    compare(
      groupKey(a.skuCode, a.fromBranchId),
      groupKey(b.skuCode, b.fromBranchId),
    ),
  );
}

function replan(
  ctx: AllocationContext,
  proposal: RebalanceProposal,
  affected: Set<string>,
): RebalanceProposal {
  const { s, totals, eligible, acceptedBySource, allowedSku } = prepare({
    ...ctx,
    proposal,
  });
  const transfers = ctx.proposal.transfers.filter(
    (t) => !affected.has(t.skuCode),
  );
  const routes = buildRouteIndex(proposal.config.routeConfig, s.branches);
  for (const code of [...affected].sort()) {
    const sku = s.skus.find((r) => r.skuCode === code) ?? fail();
    if (!allowedSku(code)) fail();
    const step = sku.quantityStep!,
      stocks = s.stocks.filter((r) => r.skuCode === code);
    const capacity = new Map<string, number>(),
      need = new Map<string, number>();
    for (const row of stocks) {
      const key = stockKey(code, row.branchId);
      capacity.set(
        row.branchId,
        stepUnits(
          Math.max(
            0,
            sumQuantities([
              row.stock,
              -row.max!,
              -(totals.outgoing.get(key) ?? 0),
            ]),
          ),
          step,
        ),
      );
      if (eligible.has(key))
        need.set(
          row.branchId,
          stepUnits(
            Math.max(
              0,
              sumQuantities([
                receiverTarget(row.min!, row.max!, proposal.config.receiverPct),
                -row.stock,
                -(totals.incoming.get(key) ?? 0),
              ]),
            ),
            step,
          ),
        );
    }
    for (const accepted of acceptedBySource.values())
      if (accepted.skuCode === code)
        transfers.push({
          sourceLineId: accepted.sourceLineId,
          skuCode: code,
          fromBranchId: accepted.fromBranchId,
          toBranchId: accepted.toBranchId,
          qty: accepted.qty,
        });
    const emit = (from: string, to: string, units: number) => {
      if (!units) return;
      if (
        !Number.isSafeInteger(units) ||
        units < 0 ||
        units > (capacity.get(from) ?? 0) ||
        units > (need.get(to) ?? 0) ||
        !routes.outgoing.get(from)?.has(to) ||
        acceptedBySource.has(sourceKey(code, from, to))
      )
        fail();
      capacity.set(from, capacity.get(from)! - units);
      need.set(to, need.get(to)! - units);
      transfers.push({
        sourceLineId: sourceKey(code, from, to),
        skuCode: code,
        fromBranchId: from,
        toBranchId: to,
        qty: quantityFromUnits(units, step),
      });
    };
    const decisions =
      proposal.allocationDecisions?.filter((d) => d.skuCode === code) ?? [];
    for (const d of decisions.filter((d) => d.mode === 'MANUAL')) {
      for (const [to, qty] of Object.entries(d.quantities ?? {})) {
        if (qty !== 0 && !isStepQuantity(qty, step)) fail();
        if (qty < 0 || !Number.isFinite(qty)) fail();
        const frozen = acceptedBySource.get(
          sourceKey(code, d.fromBranchId, to),
        );
        if (frozen) {
          if (frozen.qty !== qty) fail();
          continue;
        }
        emit(d.fromBranchId, to, stepUnits(qty, step));
      }
    }
    for (const d of decisions.filter((d) => d.mode === 'PRIORITY')) {
      const recipients = d.recipientIds.filter(
        (to) => !acceptedBySource.has(sourceKey(code, d.fromBranchId, to)),
      );
      if (
        recipients.some(
          (to) =>
            !need.has(to) || !routes.outgoing.get(d.fromBranchId)?.has(to),
        )
      )
        fail();
      const shares = splitAllocation(
        capacity.get(d.fromBranchId) ?? 0,
        recipients.map((id) => ({ id, need: need.get(id)! })),
        proposal.allocationModes?.[d.fromBranchId] ?? 'PROPORTIONAL',
      );
      for (const [to, units] of shares) emit(d.fromBranchId, to, units);
    }
    const chosen = new Set(decisions.map((d) => d.fromBranchId));
    const donors = [...capacity]
      .filter(([id, value]) => value > 0 && !chosen.has(id))
      .sort(([a], [b]) => compare(a, b))
      .map(([id, value]) => ({ id, capacity: value }));
    const receivers = [...need]
      .filter(([, value]) => value > 0)
      .sort(([a], [b]) => compare(a, b))
      .map(([id, targetNeed]) => {
        const row = stocks.find((r) => r.branchId === id)!;
        const used = sumQuantities(
          transfers
            .filter(
              (t) =>
                t.skuCode === code &&
                t.toBranchId === id &&
                !acceptedBySource.has(t.sourceLineId),
            )
            .map((t) => t.qty),
        );
        const minDeficit = Math.max(
          0,
          sumQuantities([
            row.min!,
            -row.stock,
            -(totals.incoming.get(stockKey(code, id)) ?? 0),
            -used,
          ]),
        );
        return {
          id,
          targetNeed,
          minDeficit,
          minNeed: Math.min(targetNeed, stepUnits(minDeficit, step)),
        };
      });
    // A previously accepted source line cannot be extended under the same identity.
    const allowed = new Map(
      [...routes.outgoing].map(([from, tos]) => [
        from,
        new Set(
          [...tos].filter(
            (to) => !acceptedBySource.has(sourceKey(code, from, to)),
          ),
        ),
      ]),
    );
    for (const a of allocateFlow(donors, receivers, allowed, step))
      emit(a.from, a.to, a.units);
  }
  transfers.sort((a, b) => compare(a.sourceLineId, b.sourceLineId));
  const pending = transfers.filter(
    (t) => !acceptedBySource.has(t.sourceLineId),
  );
  const planned = acceptedTotals(pending);
  const balances = s.stocks
    .map((r) => {
      const key = stockKey(r.skuCode, r.branchId),
        acceptedIncoming = totals.incoming.get(key) ?? 0,
        acceptedOutgoing = totals.outgoing.get(key) ?? 0;
      const proposedIncoming = planned.incoming.get(key) ?? 0,
        proposedOutgoing = planned.outgoing.get(key) ?? 0;
      return {
        skuCode: r.skuCode,
        branchId: r.branchId,
        stockBefore: r.stock,
        acceptedIncoming,
        acceptedOutgoing,
        proposedIncoming,
        proposedOutgoing,
        stockAfter: sumQuantities([
          r.stock,
          acceptedIncoming,
          -acceptedOutgoing,
          proposedIncoming,
          -proposedOutgoing,
        ]),
      };
    })
    .sort((a, b) =>
      compare(stockKey(a.skuCode, a.branchId), stockKey(b.skuCode, b.branchId)),
    );
  const after = new Map(
    balances.map((b) => [stockKey(b.skuCode, b.branchId), b.stockAfter]),
  );
  const uncoveredNeed = s.stocks.flatMap((r) => {
    const key = stockKey(r.skuCode, r.branchId);
    if (!eligible.has(key)) return [];
    const toTarget = Math.max(
      0,
      sumQuantities([
        receiverTarget(r.min!, r.max!, proposal.config.receiverPct),
        -after.get(key)!,
      ]),
    );
    return toTarget > 0
      ? [
          {
            skuCode: r.skuCode,
            branchId: r.branchId,
            toMin: Math.max(0, sumQuantities([r.min!, -after.get(key)!])),
            toTarget,
          },
        ]
      : [];
  });
  return {
    ...proposal,
    transfers,
    balances,
    uncoveredNeed,
    allocationRevision: (ctx.proposal.allocationRevision ?? 0) + 1,
    exclusions: proposal.exclusions.filter(
      (e) =>
        !affected.has(e.skuCode ?? '') ||
        !['NO_SURPLUS', 'NO_ROUTE'].includes(e.code),
    ),
  };
}

function rowFor(
  ctx: AllocationContext,
  sku: string,
  from: string,
): DonorAllocationRow {
  return (
    buildDonorAllocationModel(ctx).find(
      (r) => r.skuCode === sku && r.fromBranchId === from,
    ) ?? fail()
  );
}
function withDecision(
  ctx: AllocationContext,
  decision: DonorAllocationDecision,
) {
  const decisions = [...(ctx.proposal.allocationDecisions ?? [])];
  const index = decisions.findIndex(
    (d) =>
      d.skuCode === decision.skuCode &&
      d.fromBranchId === decision.fromBranchId,
  );
  if (index < 0) decisions.push(decision);
  else decisions[index] = decision;
  return replan(
    ctx,
    { ...ctx.proposal, allocationDecisions: decisions },
    new Set([decision.skuCode]),
  );
}
export function setDonorPriorities(
  ctx: AllocationContext,
  skuCode: string,
  fromBranchId: string,
  recipientIds: string[],
): RebalanceProposal {
  const row = rowFor(ctx, skuCode, fromBranchId),
    ids = [...new Set(recipientIds)].sort();
  if (
    ids.some(
      (id) =>
        !row.cells.some(
          (c) => c.toBranchId === id && (c.canAllocate || c.locked),
        ),
    )
  )
    fail();
  return withDecision(ctx, {
    skuCode,
    fromBranchId,
    recipientIds: ids,
    mode: 'PRIORITY',
  });
}
export function setDonorQuantity(
  ctx: AllocationContext,
  skuCode: string,
  fromBranchId: string,
  toBranchId: string,
  qty: number,
): RebalanceProposal {
  const row = rowFor(ctx, skuCode, fromBranchId),
    cell = row.cells.find((c) => c.toBranchId === toBranchId);
  if (
    !cell ||
    cell.locked ||
    (!cell.canAllocate && qty !== 0) ||
    !Number.isFinite(qty) ||
    qty < 0 ||
    (qty > 0 && !isStepQuantity(qty, row.step))
  )
    fail();
  const quantities = Object.fromEntries(
    row.cells
      .filter((c) => !c.locked)
      .map((c) => [c.toBranchId, c.toBranchId === toBranchId ? qty : c.qty]),
  );
  return withDecision(ctx, {
    skuCode,
    fromBranchId,
    recipientIds: row.cells
      .filter((c) => c.priority || (c.toBranchId === toBranchId && qty > 0))
      .map((c) => c.toBranchId),
    mode: 'MANUAL',
    quantities,
  });
}
export function setDonorSplitMode(
  ctx: AllocationContext,
  fromBranchId: string,
  mode: DonorSplitMode,
): RebalanceProposal {
  if (!['PROPORTIONAL', 'EQUAL'].includes(mode)) fail();
  const rows = buildDonorAllocationModel(ctx).filter(
    (r) => r.fromBranchId === fromBranchId,
  );
  if (!rows.length) fail();
  return replan(
    ctx,
    {
      ...ctx.proposal,
      allocationModes: {
        ...ctx.proposal.allocationModes,
        [fromBranchId]: mode,
      },
    },
    new Set(rows.map((r) => r.skuCode)),
  );
}
export function assertDonorPrioritiesReady(
  ctx: AllocationContext,
  sourceLineIds: string[],
): void {
  const selected = new Set(sourceLineIds);
  if (
    buildDonorAllocationModel(ctx).some(
      (r) =>
        r.priorityRequired &&
        r.cells.some((c) => c.qty > 0 && selected.has(c.sourceLineId)),
    )
  )
    throw new RebalanceError('PRIORITIES_REQUIRED');
}
