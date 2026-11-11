import { moneyProduct, moneyProductsLessThan } from '../money';
import { acceptedTotals, routeAllows } from './constraints';
import { isStepQuantity, quantityFromUnits, receiverTarget, stepUnits, sumQuantities } from './numbers';
import { getAmountExemptDonors, getTransferAmountFilter } from './transferAmounts';
import {
  RebalanceError,
  stockKey,
  type AcceptedTransfer,
  type RebalanceConfig,
  type RebalanceProposal,
  type RebalanceSnapshot,
  type RebalanceTransfer,
} from './types';

export interface TransferQuantityInput {
  snapshot: RebalanceSnapshot;
  proposal: RebalanceProposal;
  accepted: readonly AcceptedTransfer[];
  rejectedLineIds: readonly string[];
  config: RebalanceConfig;
}

export interface TransferQuantityDetails {
  maxQty: number;
  reservedOtherQty: number;
  originalQty: number;
  donorAfter: number;
  recipientAfter: number;
  donorMax: number;
  recipientMax: number;
  recipientTarget: number;
  amount: number | null;
  amountThreshold: number | null;
  belowAmountThreshold: boolean;
}

function activePlan(input: TransferQuantityInput, exceptSourceLineId?: string) {
  const resolved = new Set(input.rejectedLineIds);
  for (const line of input.accepted) {
    if (line.sourceRunId === input.proposal.runId) resolved.add(line.sourceLineId);
  }
  return [
    ...input.accepted,
    ...input.proposal.transfers.filter((line) =>
      line.sourceLineId !== exceptSourceLineId && !resolved.has(line.sourceLineId),
    ),
  ];
}

export function describeTransferQuantity(
  input: TransferQuantityInput,
  sourceLineId: string,
  draftQty?: number,
): TransferQuantityDetails | null {
  const { snapshot, proposal, accepted, config } = input;
  const line = proposal.transfers.find((t) => t.sourceLineId === sourceLineId);
  if (!line || !routeAllows(config, line.fromBranchId, line.toBranchId) || accepted.some((t) =>
    t.sourceRunId === proposal.runId && t.sourceLineId === sourceLineId,
  )) return null;

  const sku = snapshot.skus.find((s) => s.skuCode === line.skuCode);
  const rows = snapshot.stocks.filter((s) => s.skuCode === line.skuCode);
  const donor = rows.find((s) => s.branchId === line.fromBranchId);
  const recipient = rows.find((s) => s.branchId === line.toBranchId);
  if (!sku?.quantityStep || !donor || donor.max == null || !recipient ||
      recipient.min == null || recipient.max == null) return null;

  const plan = activePlan(input, sourceLineId).filter((t) => t.skuCode === line.skuCode);
  const totals = acceptedTotals(plan);
  const donorKey = stockKey(line.skuCode, line.fromBranchId);
  const recipientKey = stockKey(line.skuCode, line.toBranchId);
  const reservedOtherQty = totals.outgoing.get(donorKey) ?? 0;
  const free = Math.max(0, sumQuantities([donor.stock, -reservedOtherQty]));
  const qty = draftQty !== undefined && Number.isFinite(draftQty) && draftQty > 0
    ? draftQty : line.qty;
  const filter = getTransferAmountFilter(config);
  const price = sku.referencePrice;
  const amount = price == null ? null : moneyProduct(qty, price);
  const beforeThisRun = accepted.filter((t) => t.sourceRunId !== proposal.runId);
  const amountExempt = filter.enabled && config.stockAmountException?.enabled &&
    getAmountExemptDonors(snapshot, config, acceptedTotals(beforeThisRun).outgoing).has(donorKey);
  return {
    maxQty: quantityFromUnits(stepUnits(free, sku.quantityStep), sku.quantityStep),
    reservedOtherQty,
    originalQty: line.originalQty ?? line.qty,
    donorAfter: sumQuantities([donor.stock, totals.incoming.get(donorKey) ?? 0, -reservedOtherQty, -qty]),
    recipientAfter: sumQuantities([recipient.stock, totals.incoming.get(recipientKey) ?? 0, -(totals.outgoing.get(recipientKey) ?? 0), qty]),
    donorMax: donor.max,
    recipientMax: recipient.max,
    recipientTarget: receiverTarget(recipient.min, recipient.max, config.receiverPct),
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    amountThreshold: filter.enabled && !amountExempt ? filter.threshold : null,
    belowAmountThreshold: Boolean(filter.enabled && !amountExempt && (
      price == null || moneyProductsLessThan([[qty, price]], filter.threshold)
    )),
  };
}

/** Checks the active proposal and ledger together, once per accepted batch. */
export function assertTransferReservations(
  input: TransferQuantityInput,
  additions: readonly RebalanceTransfer[],
): void {
  const totals = acceptedTotals(activePlan(input));
  const stocks = new Map(input.snapshot.stocks.map((row) => [stockKey(row.skuCode, row.branchId), row.stock]));
  for (const line of additions) {
    const key = stockKey(line.skuCode, line.fromBranchId);
    if ((totals.outgoing.get(key) ?? 0) > (stocks.get(key) ?? 0))
      throw new RebalanceError('TRANSFER_STOCK_RESERVED');
  }
}

export function assertEditableTransferQuantity(
  input: TransferQuantityInput,
  sourceLineId: string,
  qty: number,
): void {
  const line = input.proposal.transfers.find((t) => t.sourceLineId === sourceLineId);
  if (!line) throw new RebalanceError('STALE_PROPOSAL');
  if (!routeAllows(input.config, line.fromBranchId, line.toBranchId))
    throw new RebalanceError('TRANSFER_ROUTE_UNAVAILABLE');
  const step = input.snapshot.skus.find((s) => s.skuCode === line.skuCode)?.quantityStep;
  if (!step || !isStepQuantity(qty, step)) throw new RebalanceError('INVALID_TRANSFER_QUANTITY');
  const details = describeTransferQuantity(input, sourceLineId);
  if (!details) throw new RebalanceError('STALE_PROPOSAL');
  if (qty > details.maxQty) throw new RebalanceError('TRANSFER_STOCK_RESERVED');
}
