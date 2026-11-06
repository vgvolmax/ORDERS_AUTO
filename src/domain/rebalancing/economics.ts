import { moneyProduct, moneyProductsLessThan } from '../money';
import { rebalanceConfigFingerprint } from './constraints';
import { sumQuantities } from './numbers';
import { groupTransferSkuAmounts } from './transferAmounts';
import type {
  AcceptedTransfer,
  RebalanceConfig,
  RebalanceIssue,
  RebalanceSnapshot,
} from './types';

/** Warnings for a validated ledger: cancellation never restores movements or changes their saved conditions. */
export function acceptedEconomicDiagnostics(
  snapshot: RebalanceSnapshot,
  accepted: readonly AcceptedTransfer[],
): RebalanceIssue[] {
  const prices = new Map(
    snapshot.skus.map((s) => [s.skuCode, s.referencePrice]),
  );
  const groups = new Map<
    string,
    {
      skuCode: string;
      branchId: string;
      sourceRunId: string;
      config: RebalanceConfig;
      quantities: number[];
    }
  >();
  for (const t of accepted) {
    if (
      t.acceptedConfig.transferAmountFilter ||
      !t.acceptedConfig.skuAmountFilter.enabled
    )
      continue;
    const key = JSON.stringify([
      t.sourceRunId,
      t.skuCode,
      t.toBranchId,
      rebalanceConfigFingerprint(t.acceptedConfig),
    ]);
    const group = groups.get(key) ?? {
      skuCode: t.skuCode,
      branchId: t.toBranchId,
      sourceRunId: t.sourceRunId,
      config: t.acceptedConfig,
      quantities: [],
    };
    group.quantities.push(t.qty);
    groups.set(key, group);
  }
  const issues: RebalanceIssue[] = [];
  for (const [, group] of [...groups].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const quantity = sumQuantities(group.quantities),
      price = prices.get(group.skuCode),
      threshold = group.config.skuAmountFilter.threshold;
    const context = {
      skuCode: group.skuCode,
      branchId: group.branchId,
      sourceRunId: group.sourceRunId,
      configFingerprint: rebalanceConfigFingerprint(group.config),
      quantity,
      threshold,
      severity: 'WARNING' as const,
      sourceRow: null,
    };
    if (price == null || !Number.isFinite(price) || price < 0) {
      issues.push({
        ...context,
        code: 'ACCEPTED_SKU_AMOUNT_UNKNOWN',
        message: 'Нет цены для проверки суммы сохранённых принятых перемещений',
        amount: null,
      });
    } else if (
      moneyProductsLessThan(
        group.quantities.map((qty) => [qty, price] as const),
        threshold,
      )
    ) {
      issues.push({
        ...context,
        code: 'ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD',
        message:
          'Оставшаяся сумма принятых перемещений SKU у подразделения-получателя ниже сохранённого порога',
        amount: moneyProduct(quantity, price),
      });
    }
  }
  const documents = new Map<string, AcceptedTransfer[]>();
  for (const t of accepted) {
    if (!t.acceptedConfig.transferAmountFilter?.enabled || t.amountExemptByStock)
      continue;
    const key = JSON.stringify([
      t.sourceRunId,
      rebalanceConfigFingerprint(t.acceptedConfig),
    ]);
    const lines = documents.get(key) ?? [];
    lines.push(t);
    documents.set(key, lines);
  }
  for (const [, lines] of [...documents].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const first = lines[0]!,
      threshold = first.acceptedConfig.transferAmountFilter!.threshold;
    for (const group of groupTransferSkuAmounts(snapshot, lines).values()) {
      if (
        group.amount !== null &&
        !moneyProductsLessThan(group.products, threshold)
      )
        continue;
      issues.push({
        code:
          group.amount === null
            ? 'ACCEPTED_TRANSFER_AMOUNT_UNKNOWN'
            : 'ACCEPTED_TRANSFER_AMOUNT_BELOW_THRESHOLD',
        message:
          group.amount === null
            ? 'Нет цены для проверки суммы SKU в сохранённом перемещении'
            : 'Оставшаяся сумма SKU в принятом перемещении ниже сохранённого порога',
        skuCode: group.skuCode,
        quantity: sumQuantities(group.lines.map((t) => t.qty)),
        fromBranchId: group.fromBranchId,
        toBranchId: group.toBranchId,
        sourceRunId: first.sourceRunId,
        configFingerprint: rebalanceConfigFingerprint(first.acceptedConfig),
        amount: group.amount,
        threshold,
        severity: 'WARNING',
        sourceRow: null,
      });
    }
  }
  return issues;
}
