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
  moneyGreaterThan,
  quantityFromUnits,
  receiverTarget,
  stepUnits,
  subtractQuantity,
  sumQuantities,
} from './numbers';
import { buildRouteIndex } from './routes';
import { allocateFlow, type FlowDonor, type FlowReceiver } from './flow';
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

export const ALGORITHM_VERSION = 'full-sku-network-flow-v3';
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
  for (const sku of [...s.skus].sort((a, b) => compare(a.skuCode, b.skuCode))) {
    const rows = [...(skuStocks.get(sku.skuCode) ?? [])].sort((a, b) =>
      compare(a.branchId, b.branchId),
    );
    const step = sku.quantityStep!;
    const donors: FlowDonor[] = [],
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
        const physicalSurplus = Math.max(
          0,
          sumQuantities([
            row.stock,
            -(totals.outgoing.get(key) ?? 0),
            -row.max!,
          ]),
        );
        const capacity = stepUnits(physicalSurplus, step);
        if (capacity > 0) donors.push({ id: row.branchId, capacity });
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
        eligibleRecipientKeys.push(key);
        const neededQty = Math.max(0, subtractQuantity(target, stock));
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
    if (
      (config.unitPriceFilter.enabled || config.skuAmountFilter.enabled) &&
      sku.referencePrice === null
    ) {
      emit(
        'MISSING_PRICE',
        'Нет учётной цены для активного денежного фильтра',
        sku.skuCode,
      );
      continue;
    }
    if (
      config.unitPriceFilter.enabled &&
      !moneyGreaterThan(
        1,
        sku.referencePrice!,
        config.unitPriceFilter.threshold,
      )
    ) {
      emit('UNIT_PRICE_FILTER', 'Цена не строго больше порога', sku.skuCode);
      continue;
    }
    const allocation = allocateFlow(
      donors,
      receivers,
      routes.outgoing,
      step,
      preferred,
    ).map((a) => ({
      sourceLineId: transferKey(sku.skuCode, a.from, a.to),
      skuCode: sku.skuCode,
      fromBranchId: a.from,
      toBranchId: a.to,
      qty: quantityFromUnits(a.units, step),
    }));
    const totalQty = sumQuantities(allocation.map((t) => t.qty));
    const recipients = [...neededByRecipient].map(([branchId, neededQty]) => ({
      branchId,
      neededQty,
      deliverableQty: sumQuantities(
        allocation.filter((t) => t.toBranchId === branchId).map((t) => t.qty),
      ),
    }));
    if (recipients.some((r) => r.deliverableQty !== r.neededQty)) {
      const neededQty = sumQuantities(recipients.map((r) => r.neededQty));
      const capacityQty = sumQuantities(
        donors.map((d) => quantityFromUnits(d.capacity, step)),
      );
      skippedSkus.push({
        skuCode: sku.skuCode,
        neededQty,
        deliverableQty: totalQty,
        missingQty: subtractQuantity(neededQty, totalQty),
        reason: stepLimited
          ? 'QUANTITY_STEP'
          : capacityQty < neededQty
            ? 'INSUFFICIENT_SURPLUS'
            : 'ROUTE_LIMIT',
        recipients,
      });
      continue;
    }
    if (
      config.skuAmountFilter.enabled &&
      !moneyGreaterThan(
        totalQty,
        sku.referencePrice!,
        config.skuAmountFilter.threshold,
      )
    ) {
      emit(
        'SKU_AMOUNT_FILTER',
        'Общая сумма перемещений артикула не строго больше порога',
        sku.skuCode,
        { quantity: totalQty, amount: totalQty * sku.referencePrice! },
      );
      continue;
    }
    transfers.push(...allocation);
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
        JSON.stringify([a.skuCode, a.branchId, a.code, a.sourceRow]),
        JSON.stringify([b.skuCode, b.branchId, b.code, b.sourceRow]),
      ),
    ),
  };
}
