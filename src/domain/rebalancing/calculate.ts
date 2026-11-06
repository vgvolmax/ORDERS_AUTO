import { moneyProductsLessThan } from '../money';
import {
  getAmountExemptDonors,
  getTransferAmountFilter,
  groupTransferSkuAmounts,
  minimumTransferUnits,
} from './transferAmounts';
import { validatedSnapshot } from './validation';
import {
  assertConfig,
  acceptedTotals,
  branchParticipationFingerprint,
  rebalanceConfigFingerprint,
  validateAcceptedLedger,
} from './constraints';
import {
  isStepQuantity,
  quantityFromUnits,
  receiverTarget,
  stepUnits,
  subtractQuantity,
  sumQuantities,
} from './numbers';
import { buildRouteIndex } from './routes';
import { allocateFlow, type FlowReceiver } from './flow';
import {
  eligibleDonorRoutes,
  MAX_STATES_PER_CALCULATION,
  prioritizeDonorStock,
  type StockDonor,
} from './donorStockPriority';
import { acceptedEconomicDiagnostics } from './economics';
import {
  RebalanceError,
  stockKey,
  type RebalanceConfig,
  type RebalanceSnapshot,
  type AcceptedTransfer,
  type RebalanceResult,
  type RebalanceTransfer,
  type RebalanceIssue,
  type RebalanceStock,
  type SkippedRebalanceSku,
} from './types';

export const ALGORITHM_VERSION = 'full-sku-joint-donor-plan-v7';
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const transferKey = (skuCode: string, from: string, to: string) =>
  JSON.stringify([skuCode, from, to]);
function fingerprint(
  s: RebalanceSnapshot,
  config: RebalanceConfig,
  accepted: AcceptedTransfer[],
): string {
  return JSON.stringify([
    ALGORITHM_VERSION,
    s.snapshotId,
    rebalanceConfigFingerprint(config),
    s.branches
      .map((b) => [b.id, b.active])
      .sort((a, b) => compare(String(a[0]), String(b[0]))),
    s.skus
      .map((v) => [v.skuCode, v.unit, v.quantityStep, v.referencePrice])
      .sort((a, b) => compare(String(a[0]), String(b[0]))),
    s.stocks
      .map((v) => [v.skuCode, v.branchId, v.stock, v.min, v.max])
      .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
    accepted
      .map((v) => [
        v.transferId,
        v.sourceRunId,
        v.sourceLineId,
        v.skuCode,
        v.fromBranchId,
        v.toBranchId,
        v.qty,
        rebalanceConfigFingerprint(v.acceptedConfig),
        ...(v.amountExemptByStock ? [true] : []),
      ])
      .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  ]);
}

export function calculateRebalance(
  input: RebalanceSnapshot,
  config: RebalanceConfig,
  accepted: AcceptedTransfer[],
): RebalanceResult {
  assertConfig(config);
  const amountFilter = getTransferAmountFilter(config);
  const validated = validatedSnapshot(input),
    s = validated.snapshot;
  const ledgerIssues = validateAcceptedLedger(s, accepted);
  if (ledgerIssues.length)
    throw new RebalanceError('INVALID_ACCEPTED_LEDGER', ledgerIssues);
  const exclusions = [
      ...validated.issues,
      ...acceptedEconomicDiagnostics(s, accepted),
    ],
    routes = buildRouteIndex(config.routeConfig, s.branches),
    totals = acceptedTotals(accepted);
  const exemptDonors = getAmountExemptDonors(s, config, totals.outgoing);
  for (const p of routes.stalePairs)
    exclusions.push({
      code: 'STALE_ROUTE',
      message: `Маршрут содержит отсутствующее/неактивное подразделение: ${p.branchAId} / ${p.branchBId}`,
      severity: 'WARNING',
      sourceRow: null,
    });
  const skuStocks = new Map<string, RebalanceStock[]>();
  for (const line of s.stocks) {
    const rows = skuStocks.get(line.skuCode) ?? [];
    rows.push(line);
    skuStocks.set(line.skuCode, rows);
  }
  const projected = (line: RebalanceStock) =>
    sumQuantities([
      line.stock,
      -(totals.outgoing.get(stockKey(line.skuCode, line.branchId)) ?? 0),
      totals.incoming.get(stockKey(line.skuCode, line.branchId)) ?? 0,
    ]);
  const transfers: RebalanceTransfer[] = [],
    filteredCandidates: RebalanceTransfer[] = [],
    eligibleRecipientKeys: string[] = [],
    skippedSkus: SkippedRebalanceSku[] = [];
  const active = new Set(s.branches.filter((b) => b.active).map((b) => b.id));
  const hasInbound = (id: string) =>
    [...routes.outgoing.values()].some((targets) => targets.has(id));
  const targetByKey = new Map<string, number>();
  const emit = (
    code: string,
    message: string,
    skuCode: string,
    extra: Partial<RebalanceIssue> = {},
  ) =>
    exclusions.push({
      code,
      message,
      skuCode,
      severity: 'WARNING',
      sourceRow: null,
      ...extra,
    });
  const preferred = new Set(
    accepted.map((t) => JSON.stringify([t.fromBranchId, t.toBranchId])),
  );
  const searchBudget = { remaining: MAX_STATES_PER_CALCULATION };
  for (const sku of [...s.skus].sort((a, b) => compare(a.skuCode, b.skuCode))) {
    const rows = [...(skuStocks.get(sku.skuCode) ?? [])].sort((a, b) =>
      compare(a.branchId, b.branchId),
    );
    const step = sku.quantityStep!;
    const minimumUnits = amountFilter.enabled
      ? minimumTransferUnits(step, sku.referencePrice, amountFilter.threshold)
      : 1;
    const donors: StockDonor[] = [],
      receivers: FlowReceiver[] = [];
    const neededByRecipient = new Map<string, number>();
    let stepLimited = false;
    // Keep data errors separate from capacity skips; never certify an omitted known row as covered.
    if (
      validated.issues.some(
        (i) =>
          i.severity === 'ERROR' &&
          i.skuCode === sku.skuCode &&
          (!i.branchId || (active.has(i.branchId) && hasInbound(i.branchId))),
      )
    )
      continue;
    try {
      for (const row of rows) {
        if (!active.has(row.branchId)) continue;
        const key = stockKey(row.skuCode, row.branchId),
          stock = projected(row);
        const reserved = totals.outgoing.get(key) ?? 0;
        const physicalSurplus = Math.max(
          0, sumQuantities([row.stock, -reserved, -row.max!]),
        );
        const capacity = stepUnits(physicalSurplus, step);
        if (capacity > 0) donors.push({
          id: row.branchId,
          capacity,
          stock: subtractQuantity(row.stock, reserved),
          max: row.max!,
          minimumUnits: exemptDonors.has(key) ? 1 : minimumUnits,
        });
        if (!hasInbound(row.branchId)) continue;
        const trigger =
          config.recipientTrigger === 'BELOW_MIN' ? row.min! : row.max!;
        if (stock >= trigger) {
          if (stock < row.max!)
            emit(
              'NOT_BELOW_TRIGGER',
              'Остаток не ниже выбранного порога получателя',
              row.skuCode,
              { branchId: row.branchId, sourceRow: row.sourceRow },
            );
          continue;
        }
        const target = receiverTarget(row.min!, row.max!, config.receiverPct);
        targetByKey.set(key, target);
        const neededQty = Math.max(0, subtractQuantity(target, stock));
        eligibleRecipientKeys.push(key);
        if (neededQty > 0) {
          neededByRecipient.set(row.branchId, neededQty);
          if (!isStepQuantity(neededQty, step)) stepLimited = true;
        }
        const targetNeed = stepUnits(neededQty, step);
        const minDeficit = Math.max(0, subtractQuantity(row.min!, stock));
        const minNeed = Math.min(targetNeed, stepUnits(minDeficit, step));
        if (targetNeed > 0)
          receivers.push({ id: row.branchId, minNeed, minDeficit, targetNeed });
        else
          emit(
            'TARGET_OR_STEP_LIMIT',
            'Цель достигнута либо остаток потребности меньше шага',
            row.skuCode,
            { branchId: row.branchId, sourceRow: row.sourceRow },
          );
      }
      const totalCapacity = donors.reduce((sum, d) => sum + d.capacity, 0);
      if (!Number.isSafeInteger(totalCapacity))
        throw new RangeError('Суммарная ёмкость неточна');
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      emit(
        'UNSAFE_QUANTITY_CAPACITY',
        'Количество шагов превышает безопасную точность; уточните единицу/шаг',
        sku.skuCode,
      );
      continue;
    }
    const physicalFlow = allocateFlow(
      donors,
      receivers,
      routes.outgoing,
      step,
      preferred,
    );
    // A receiver blocked only by the monetary minimum must not consume physical capacity.
    const excludedReceivers = new Set<string>();
    if (amountFilter.enabled) {
      const eligible = new Set(receivers.filter((receiver) =>
        eligibleDonorRoutes(donors, receiver, routes.outgoing).length > 0,
      ).map((receiver) => receiver.id));
      if (eligible.size > 0) {
        for (const receiver of receivers) {
          if (!eligible.has(receiver.id) &&
            donors.some((donor) => routes.outgoing.get(donor.id)?.has(receiver.id)))
            excludedReceivers.add(receiver.id);
        }
      }
    }
    const checkedReceivers = receivers.filter((receiver) => !excludedReceivers.has(receiver.id));
    const checkedFlow = excludedReceivers.size > 0
      ? allocateFlow(donors, checkedReceivers, routes.outgoing, step, preferred)
      : physicalFlow;
    const recipients = [...neededByRecipient]
      .filter(([branchId]) => !excludedReceivers.has(branchId))
      .map(([branchId, neededQty]) => ({
      branchId,
      neededQty,
      deliverableQty: sumQuantities(
        checkedFlow.filter((t) => t.to === branchId)
          .map((t) => quantityFromUnits(t.units, step)),
      ),
    }));
    if (recipients.some((r) => r.deliverableQty !== r.neededQty)) {
      const neededQty = sumQuantities(recipients.map((r) => r.neededQty));
      const deliverableQty = sumQuantities(recipients.map((r) => r.deliverableQty));
      const capacityQty = sumQuantities(
        donors.map((d) => quantityFromUnits(d.capacity, step)),
      );
      skippedSkus.push({
        skuCode: sku.skuCode,
        neededQty,
        deliverableQty,
        missingQty: subtractQuantity(neededQty, deliverableQty),
        reason: stepLimited
          ? 'QUANTITY_STEP'
          : capacityQty < neededQty
            ? 'INSUFFICIENT_SURPLUS'
            : 'ROUTE_LIMIT',
        recipients,
      });
      continue;
    }
    const allocation = prioritizeDonorStock(
      donors, checkedReceivers, routes.outgoing, step, preferred, checkedFlow, searchBudget,
    );
    if (allocation.limited) emit(
      'TRANSFER_SEARCH_LIMIT',
      'Поиск остановлен по лимиту расчёта. Показан лучший из проверенных допустимых планов',
      sku.skuCode,
    );
    const planned = allocation.lines.map((a) => ({
      sourceLineId: transferKey(sku.skuCode, a.from, a.to),
      skuCode: sku.skuCode,
      fromBranchId: a.from,
      toBranchId: a.to,
      qty: quantityFromUnits(a.units, step),
    }));
    transfers.push(...planned);
    if (amountFilter.enabled) {
      const plannedUnits = new Map<string, number>();
      for (const line of allocation.lines)
        plannedUnits.set(line.to, (plannedUnits.get(line.to) ?? 0) + line.units);
      const unfinished = new Set(
        receivers.filter((r) => plannedUnits.get(r.id) !== r.targetNeed).map((r) => r.id),
      );
      const donorMinimum = new Map(donors.map((d) => [d.id, d.minimumUnits]));
      const diagnosticFlow = [...physicalFlow];
      const attempted = new Set(physicalFlow.map((line) => line.to));
      for (const receiver of receivers) {
        if (!excludedReceivers.has(receiver.id) || attempted.has(receiver.id))
          continue;
        for (const donor of donors) {
          if (routes.outgoing.get(donor.id)?.has(receiver.id))
            diagnosticFlow.push({
              from: donor.id,
              to: receiver.id,
              units: Math.min(donor.capacity, receiver.targetNeed),
            });
        }
      }
      for (const a of diagnosticFlow) {
        if (!unfinished.has(a.to) || a.units >= donorMinimum.get(a.from)!) continue;
        filteredCandidates.push({
          sourceLineId: transferKey(sku.skuCode, a.from, a.to),
          skuCode: sku.skuCode,
          fromBranchId: a.from,
          toBranchId: a.to,
          qty: quantityFromUnits(a.units, step),
        });
      }
    }
  }
  // If the amount rule prevents a complete plan, retain the qualifying lines.
  if (amountFilter.enabled) {
    const excluded = new Set<RebalanceTransfer>();
    const proposedIds = new Set(transfers.map((t) => t.sourceLineId));
    const checkedLines = [
      ...transfers,
      ...filteredCandidates.filter((t) => !proposedIds.has(t.sourceLineId)),
    ];
    for (const group of groupTransferSkuAmounts(s, checkedLines).values()) {
      if (exemptDonors.has(stockKey(group.skuCode, group.fromBranchId))) continue;
      if (
        group.amount !== null &&
        !moneyProductsLessThan(group.products, amountFilter.threshold)
      )
        continue;
      group.lines.forEach((t) => excluded.add(t));
      exclusions.push({
        code:
          group.amount === null
            ? 'TRANSFER_AMOUNT_UNKNOWN'
            : 'TRANSFER_AMOUNT_FILTER',
        message:
          group.amount === null
            ? 'Неизвестна сумма SKU в перемещении'
            : 'Сумма SKU в перемещении ниже порога',
        severity: 'WARNING',
        sourceRow: null,
        skuCode: group.skuCode,
        fromBranchId: group.fromBranchId,
        toBranchId: group.toBranchId,
        amount: group.amount,
        threshold: amountFilter.threshold,
      });
    }
    for (let i = transfers.length - 1; i >= 0; i--)
      if (excluded.has(transfers[i]!)) transfers.splice(i, 1);
  }
  transfers.sort((a, b) => compare(a.sourceLineId, b.sourceLineId));
  const proposedIncoming = new Map<string, number[]>(),
    proposedOutgoing = new Map<string, number[]>();
  for (const t of transfers) {
    const from = stockKey(t.skuCode, t.fromBranchId),
      to = stockKey(t.skuCode, t.toBranchId);
    const out = proposedOutgoing.get(from) ?? [];
    out.push(t.qty);
    proposedOutgoing.set(from, out);
    const incoming = proposedIncoming.get(to) ?? [];
    incoming.push(t.qty);
    proposedIncoming.set(to, incoming);
  }
  const balances = s.stocks
    .map((row) => {
      const key = stockKey(row.skuCode, row.branchId),
        proposedIn = sumQuantities(proposedIncoming.get(key) ?? []),
        proposedOut = sumQuantities(proposedOutgoing.get(key) ?? []);
      return {
        skuCode: row.skuCode,
        branchId: row.branchId,
        stockBefore: row.stock,
        acceptedIncoming: totals.incoming.get(key) ?? 0,
        acceptedOutgoing: totals.outgoing.get(key) ?? 0,
        proposedIncoming: proposedIn,
        proposedOutgoing: proposedOut,
        stockAfter: sumQuantities([projected(row), proposedIn, -proposedOut]),
      };
    })
    .sort((a, b) =>
      compare(stockKey(a.skuCode, a.branchId), stockKey(b.skuCode, b.branchId)),
    );
  const balancesByKey = new Map(
    balances.map((b) => [stockKey(b.skuCode, b.branchId), b]),
  );
  const uncoveredNeed = s.stocks
    .flatMap((row) => {
      const key = stockKey(row.skuCode, row.branchId),
        target = targetByKey.get(key);
      if (target === undefined) return [];
      const after = balancesByKey.get(key)!.stockAfter;
      const toMin = Math.max(0, subtractQuantity(row.min!, after)),
        toTarget = Math.max(0, subtractQuantity(target, after));
      if (toTarget > 0)
        return [
          { skuCode: row.skuCode, branchId: row.branchId, toMin, toTarget },
        ];
      return [];
    })
    .sort((a, b) =>
      compare(stockKey(a.skuCode, a.branchId), stockKey(b.skuCode, b.branchId)),
    );
  return {
    inputFingerprint: fingerprint(s, config, accepted),
    algorithmVersion: ALGORITHM_VERSION,
    participationFingerprint: branchParticipationFingerprint(s.branches),
    skippedSkus,
    transfers,
    eligibleRecipientKeys: [...new Set(eligibleRecipientKeys)].sort(),
    uncoveredNeed,
    balances,
    exclusions: exclusions.sort((a, b) =>
      compare(
        JSON.stringify([
          a.skuCode,
          a.branchId,
          a.fromBranchId,
          a.toBranchId,
          a.code,
          a.sourceRow,
        ]),
        JSON.stringify([
          b.skuCode,
          b.branchId,
          b.fromBranchId,
          b.toBranchId,
          b.code,
          b.sourceRow,
        ]),
      ),
    ),
  };
}
