import {
  calculateRebalance,
  rebalanceConfigFingerprint,
} from '../../src/domain/rebalancing';
import type {
  AcceptedTransfer,
  RebalanceProposal,
  RebalanceSnapshot,
} from '../../src/domain/rebalancing';
import { config } from './rebalanceFixtures';
export function donorTierContext(
  surplus = 100,
  needs = [80, 60, 20, 70],
  step = 1,
) {
  const snapshot: RebalanceSnapshot = {
    schemaVersion: 1,
    snapshotId: 'tiers',
    branches: ['D', ...needs.map((_, i) => `R${i + 1}`)].map((id) => ({
      id,
      name: id,
      active: true,
      aliases: [],
    })),
    skus: [
      {
        skuCode: 'SKU',
        name: 'Товар',
        unit: 'шт',
        quantityStep: step,
        referencePrice: 10,
      },
    ],
    stocks: [
      {
        skuCode: 'SKU',
        branchId: 'D',
        stock: 10 + surplus,
        min: 5,
        max: 10,
        sourceRow: 1,
      },
      ...needs.map((max, i) => ({
        skuCode: 'SKU',
        branchId: `R${i + 1}`,
        stock: 0,
        min: Math.min(1, max),
        max,
        sourceRow: i + 2,
      })),
    ],
  };
  const c = config();
  const proposal: RebalanceProposal = {
    ...calculateRebalance(snapshot, c, []),
    config: c,
    configFingerprint: rebalanceConfigFingerprint(c),
    runId: 'run',
    snapshotId: 'tiers',
    baseAcceptedRevision: 0,
    createdAt: '2026-10-23T00:00:00Z',
  };
  return { snapshot, proposal, accepted: [] as AcceptedTransfer[] };
}
export const tierQuantities = (p: RebalanceProposal) =>
  ['R1', 'R2', 'R3', 'R4'].map((id) =>
    p.transfers
      .filter((t) => t.fromBranchId === 'D' && t.toBranchId === id)
      .reduce((n, t) => n + t.qty, 0),
  );
