import { validateRebalanceSnapshot } from './validation';
import { isStepQuantity, receiverTarget, sumQuantities } from './numbers';
import { RebalanceError, stockKey, type RebalanceConfig, type RouteDirection, type RebalanceSnapshot, type AcceptedTransfer, type RebalanceIssue } from './types';

export const routePairKey = (a: string, b: string): string => JSON.stringify([a, b].sort());
export function routeRules(config: Pick<RebalanceConfig, 'routeConfig'>): Map<string, { a: string; b: string; direction: RouteDirection }> {
  const rules = new Map<string, { a: string; b: string; direction: RouteDirection }>();
  for (const pair of config.routeConfig.pairs) {
    const key = routePairKey(pair.branchAId, pair.branchBId);
    if (!pair.branchAId || !pair.branchBId || pair.branchAId === pair.branchBId || rules.has(key) || !['BOTH', 'A_TO_B', 'B_TO_A', 'BLOCKED'].includes(pair.direction))
      throw new RebalanceError('INVALID_CONFIG');
    rules.set(key, { a: pair.branchAId, b: pair.branchBId, direction: pair.direction });
  }
  return rules;
}
export function assertConfig(config: RebalanceConfig): void {
  if (!['BELOW_MIN', 'BELOW_MAX'].includes(config.recipientTrigger) || !Number.isFinite(config.receiverPct) || config.receiverPct < 0 || config.receiverPct > 100 || !['ALL_ALLOWED', 'SELECTIVE'].includes(config.routeConfig.mode))
    throw new RebalanceError('INVALID_CONFIG');
  for (const filter of [config.unitPriceFilter, config.skuAmountFilter]) {
    if (typeof filter.enabled !== 'boolean' || !Number.isFinite(filter.threshold) || filter.threshold < 0) throw new RebalanceError('INVALID_CONFIG');
  }
  routeRules(config);
}
export function routeAllows(config: Pick<RebalanceConfig, 'routeConfig'>, from: string, to: string, rules = routeRules(config)): boolean {
  if (from === to) return false;
  const rule = rules.get(routePairKey(from, to));
  if (!rule) return config.routeConfig.mode === 'ALL_ALLOWED';
  return rule.direction === 'BOTH' || (rule.direction === 'A_TO_B' && from === rule.a) || (rule.direction === 'B_TO_A' && from === rule.b);
}
export function rebalanceConfigFingerprint(config: RebalanceConfig): string {
  assertConfig(config);
  const pairs = [...routeRules(config)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, r]) => {
    const [a] = JSON.parse(key) as string[];
    const direction = r.a === a || r.direction === 'BOTH' || r.direction === 'BLOCKED' ? r.direction : r.direction === 'A_TO_B' ? 'B_TO_A' : 'A_TO_B';
    return [key, direction];
  });
  // Canonical serialization is collision-free and synchronous; no clock, storage or browser crypto.
  return JSON.stringify([config.recipientTrigger, config.receiverPct, config.routeConfig.mode, pairs,
    config.unitPriceFilter.enabled, config.unitPriceFilter.threshold, config.skuAmountFilter.enabled, config.skuAmountFilter.threshold]);
}
export function assertSnapshot(snapshot: RebalanceSnapshot): void {
  const errors = validateRebalanceSnapshot(snapshot).filter((i) => i.severity === 'ERROR');
  if (errors.length) throw new RebalanceError('INVALID_SNAPSHOT', errors);
}
export interface AcceptedTotals { incoming: Map<string, number>; outgoing: Map<string, number> }
export function acceptedTotals(accepted: readonly AcceptedTransfer[]): AcceptedTotals {
  const incoming = new Map<string, number[]>(), outgoing = new Map<string, number[]>();
  for (const t of accepted) {
    const from = stockKey(t.skuCode, t.fromBranchId), to = stockKey(t.skuCode, t.toBranchId);
    const a = outgoing.get(from) ?? []; a.push(t.qty); outgoing.set(from, a);
    const b = incoming.get(to) ?? []; b.push(t.qty); incoming.set(to, b);
  }
  return { incoming: new Map([...incoming].map(([k, values]) => [k, sumQuantities(values)])), outgoing: new Map([...outgoing].map(([k, values]) => [k, sumQuantities(values)])) };
}
export function validateAcceptedLedger(snapshot: RebalanceSnapshot, accepted: readonly AcceptedTransfer[]): RebalanceIssue[] {
  const stocks = new Map(snapshot.stocks.map((s) => [stockKey(s.skuCode, s.branchId), s]));
  const skus = new Map(snapshot.skus.map((s) => [s.skuCode, s]));
  const issues: RebalanceIssue[] = [];
  const ids = new Set<string>(), sources = new Set<string>(), upper = new Map<string, number>();
  const issue = (t: AcceptedTransfer, message: string) => issues.push({ code: 'INVALID_ACCEPTED_TRANSFER', message, severity: 'ERROR', sourceRow: null, skuCode: t.skuCode });
  for (const t of accepted) {
    const source = JSON.stringify([t.sourceRunId, t.sourceLineId]);
    if (!t.transferId || ids.has(t.transferId) || sources.has(source) || !t.sourceRunId || !t.sourceLineId || t.snapshotId !== snapshot.snapshotId || !Number.isFinite(Date.parse(t.acceptedAt))) {
      issue(t, 'Повтор, отсутствующая идентичность или несовместимый снимок принятого движения'); continue;
    }
    ids.add(t.transferId); sources.add(source);
    const from = stocks.get(stockKey(t.skuCode, t.fromBranchId)), to = stocks.get(stockKey(t.skuCode, t.toBranchId)), sku = skus.get(t.skuCode);
    try { assertConfig(t.acceptedConfig); } catch { issue(t, 'Некорректные сохранённые условия'); continue; }
    if (!from || !to || !sku?.quantityStep || t.fromBranchId === t.toBranchId || !isStepQuantity(t.qty, sku.quantityStep) || !routeAllows(t.acceptedConfig, t.fromBranchId, t.toBranchId)) {
      issue(t, 'Недопустимы количество, шаг, стороны или маршрут'); continue;
    }
    const threshold = t.acceptedConfig.recipientTrigger === 'BELOW_MIN' ? to.min! : to.max!;
    if (to.stock >= threshold) issue(t, 'Получатель не соответствовал исходному условию');
    const key = stockKey(t.skuCode, t.toBranchId);
    upper.set(key, Math.max(upper.get(key) ?? 0, receiverTarget(to.min!, to.max!, t.acceptedConfig.receiverPct)));
  }
  if (issues.length) return issues;
  const totals = acceptedTotals(accepted);
  for (const s of snapshot.stocks) {
    const key = stockKey(s.skuCode, s.branchId), out = totals.outgoing.get(key) ?? 0, incoming = totals.incoming.get(key) ?? 0;
    if ((out > 0 && sumQuantities([s.stock, -out]) < s.max!) || (incoming > 0 && sumQuantities([s.stock, incoming]) > (upper.get(key) ?? s.max!)))
      issues.push({ code: 'ACCEPTED_CAP_EXCEEDED', message: 'Принятые движения нарушают Max донора или цель получателя', severity: 'ERROR', sourceRow: s.sourceRow, skuCode: s.skuCode, branchId: s.branchId });
  }
  return issues;
}
