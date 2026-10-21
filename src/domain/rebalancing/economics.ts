import { rebalanceConfigFingerprint } from './constraints';
import { moneyGreaterThan, sumQuantities } from './numbers';
import type { AcceptedTransfer, RebalanceConfig, RebalanceIssue, RebalanceSnapshot } from './types';

/** Warnings for a validated ledger: cancellation never restores movements or changes their saved conditions. */
export function acceptedEconomicDiagnostics(snapshot: RebalanceSnapshot, accepted: readonly AcceptedTransfer[]): RebalanceIssue[] {
  const prices = new Map(snapshot.skus.map((s) => [s.skuCode, s.referencePrice]));
  const groups = new Map<string, { skuCode: string; sourceRunId: string; config: RebalanceConfig; quantities: number[] }>();
  for (const t of accepted) {
    if (!t.acceptedConfig.skuAmountFilter.enabled) continue;
    const key = JSON.stringify([t.sourceRunId, t.skuCode, rebalanceConfigFingerprint(t.acceptedConfig)]);
    const group = groups.get(key) ?? { skuCode: t.skuCode, sourceRunId: t.sourceRunId, config: t.acceptedConfig, quantities: [] };
    group.quantities.push(t.qty); groups.set(key, group);
  }
  const issues: RebalanceIssue[] = [];
  for (const [, group] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const quantity = sumQuantities(group.quantities), price = prices.get(group.skuCode), threshold = group.config.skuAmountFilter.threshold;
    const context = { skuCode: group.skuCode, sourceRunId: group.sourceRunId, configFingerprint: rebalanceConfigFingerprint(group.config), quantity, threshold, severity: 'WARNING' as const, sourceRow: null };
    if (price == null || !Number.isFinite(price) || price < 0) {
      issues.push({ ...context, code: 'ACCEPTED_SKU_AMOUNT_UNKNOWN', message: 'Нет цены для проверки суммы сохранённых принятых перемещений', amount: null });
    } else if (!moneyGreaterThan(quantity, price, threshold)) {
      issues.push({ ...context, code: 'ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD', message: 'Оставшаяся сумма принятых перемещений артикула не строго больше сохранённого порога', amount: quantity * price });
    }
  }
  return issues;
}
