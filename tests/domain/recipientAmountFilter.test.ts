import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import {
  acceptTransfers,
  revokeTransfers,
} from '../../src/domain/rebalancing/acceptedTransfers';
import { acceptedEconomicDiagnostics } from '../../src/domain/rebalancing/economics';
import { rebalanceConfigFingerprint } from '../../src/domain/rebalancing/constraints';
import type {
  AcceptedTransfer,
  RebalanceConfig,
  RebalanceProposal,
  RebalanceSnapshot,
} from '../../src/domain/rebalancing/types';
import { config } from '../fixtures/rebalanceFixtures';

function network(
  needs: number[],
  surplus = needs.reduce((a, b) => a + b, 0),
  price = 1000,
): RebalanceSnapshot {
  const ids = ['D', ...needs.map((_, i) => 'R' + i)];
  return {
    schemaVersion: 1,
    snapshotId: 'recipient-filter',
    branches: ids.map((id) => ({ id, name: id, active: true, aliases: [] })),
    skus: [
      {
        skuCode: 'SKU1',
        name: 'Товар',
        unit: 'шт',
        quantityStep: 1,
        referencePrice: price,
      },
    ],
    stocks: [
      {
        skuCode: 'SKU1',
        branchId: 'D',
        stock: 100 + surplus,
        min: 0,
        max: 100,
        sourceRow: 1,
      },
      ...needs.map((max, i) => ({
        skuCode: 'SKU1',
        branchId: 'R' + i,
        stock: 0,
        min: max,
        max,
        sourceRow: i + 2,
      })),
    ],
  };
}
const settings = (threshold = 10000) =>
  config({ skuAmountFilter: { enabled: true, threshold } });
function plan(
  s: RebalanceSnapshot,
  c: RebalanceConfig,
  accepted: AcceptedTransfer[] = [],
): RebalanceProposal {
  return {
    ...calculateRebalance(s, c, accepted),
    runId: 'run',
    snapshotId: s.snapshotId,
    createdAt: '2026-11-03T09:00:00Z',
    baseAcceptedRevision: 0,
    config: c,
    configFingerprint: rebalanceConfigFingerprint(c),
  };
}
function accept(
  s: RebalanceSnapshot,
  p: RebalanceProposal,
  accepted: AcceptedTransfer[] = [],
  ids = p.transfers.map((t) => t.sourceLineId),
) {
  return acceptTransfers({
    snapshot: s,
    currentProposal: p,
    currentAccepted: accepted,
    selectedLineIds: ids,
    currentRevision: accepted.length ? 1 : 0,
    expectedRevision: accepted.length ? 1 : 0,
    currentConfigFingerprint: p.configFingerprint,
    acceptedAt: '2026-11-03T09:01:00Z',
    transferIdBySourceLineId: Object.fromEntries(
      p.transfers.map((t, i) => [t.sourceLineId, 't' + i]),
    ),
  });
}

describe('legacy recipient amount conditions remain readable', () => {
  it('keeps saved economic warnings separate for recipients of the same SKU', () => {
    const s = network([6, 6]);
    const ledger = s.stocks.slice(1).map(
      (r, i): AcceptedTransfer => ({
        transferId: 't' + i,
        sourceRunId: 'old',
        sourceLineId: 'l' + i,
        skuCode: 'SKU1',
        fromBranchId: 'D',
        toBranchId: r.branchId,
        qty: 6,
        snapshotId: s.snapshotId,
        acceptedAt: '2026-11-03T08:00:00Z',
        acceptedConfig: settings(),
      }),
    );
    expect(
      acceptedEconomicDiagnostics(s, ledger).map((i) => [i.branchId, i.amount]),
    ).toEqual([
      ['R0', 6000],
      ['R1', 6000],
    ]);
  });
  it('requires recalculation of v4 proposals while allowing accepted no-op and revoke', () => {
    const s = network([10]),
      p = plan(s, settings());
    const old = accept(s, p).nextAccepted;
    p.algorithmVersion = 'full-sku-recipient-amount-v4';
    expect(() => accept(s, p)).toThrow('STALE_PROPOSAL');
    expect(accept(s, p, old).nextAccepted).toBe(old);
    expect(
      revokeTransfers({
        snapshot: s,
        currentAccepted: old,
        transferIds: old.map((t) => t.transferId),
        currentRevision: 1,
        expectedRevision: 1,
      }).nextAccepted,
    ).toEqual([]);
  });
});
