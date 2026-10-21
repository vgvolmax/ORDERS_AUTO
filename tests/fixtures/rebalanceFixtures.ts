import type { RebalanceConfig, RebalanceSnapshot, BranchRegistry } from '../../src/domain/rebalancing/types';

export function registry(): BranchRegistry {
  return [
    { id: 'D', name: 'Донор', active: true, aliases: ['Старый донор'] },
    { id: 'R', name: 'Получатель', active: true, aliases: [] },
  ];
}
export function snapshot(overrides: Partial<RebalanceSnapshot> = {}): RebalanceSnapshot {
  return {
    schemaVersion: 1, snapshotId: 'snapshot-1', branches: registry(),
    skus: [{ skuCode: '00001', name: 'Товар', unit: 'шт', quantityStep: 1, referencePrice: 1200 }],
    stocks: [
      { skuCode: '00001', branchId: 'D', stock: 80, min: 20, max: 60, sourceRow: 3 },
      { skuCode: '00001', branchId: 'R', stock: 10, min: 20, max: 60, sourceRow: 4 },
    ],
    ...overrides,
  };
}
export function config(overrides: Partial<RebalanceConfig> = {}): RebalanceConfig {
  return {
    recipientTrigger: 'BELOW_MIN', receiverPct: 100,
    routeConfig: { mode: 'ALL_ALLOWED', pairs: [] },
    unitPriceFilter: { enabled: false, threshold: 1000 },
    skuAmountFilter: { enabled: false, threshold: 10000 },
    ...overrides,
  };
}
