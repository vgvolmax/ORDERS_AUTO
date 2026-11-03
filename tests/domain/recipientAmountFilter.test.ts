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

describe('SKU minimum value belongs to a single recipient', () => {
  it('selects exactly two recipients from a 50000 RUB network, without spending surplus on smaller needs', () => {
    const s = network([12, 10, 8, 7, 7, 6], 22),
      p = plan(s, settings());
    expect(p.transfers.map((t) => [t.toBranchId, t.qty])).toEqual([
      ['R0', 12],
      ['R1', 10],
    ]);
    expect(p.skippedSkus).toEqual([]);
    expect(p.eligibleRecipientKeys).toEqual(['["SKU1","R0"]', '["SKU1","R1"]']);
    expect(
      p.exclusions
        .filter((i) => i.code === 'SKU_AMOUNT_FILTER')
        .map((i) => [i.branchId, i.amount, i.threshold]),
    ).toEqual([
      ['R2', 8000, 10000],
      ['R3', 7000, 10000],
      ['R4', 7000, 10000],
      ['R5', 6000, 10000],
    ]);
    expect(p.balances.find((b) => b.branchId === 'D')!.stockAfter).toBe(100);
  });
  it('does not combine two small recipients into one passing amount', () => {
    const p = plan(network([6, 6]), settings());
    expect(p.transfers).toEqual([]);
    expect(p.skippedSkus).toEqual([]);
    expect(
      p.exclusions.filter((i) => i.code === 'SKU_AMOUNT_FILTER'),
    ).toHaveLength(2);
  });
  it.each([
    [0.1, 0.3, 3],
    [1000, 10000, 10],
  ] as const)(
    'includes exact monetary equality at price%s and threshold%s',
    (price, threshold, need) => {
      const s = network([need], need, price),
        p = plan(s, settings(threshold));
      expect(p.transfers.map((t) => t.qty)).toEqual([need]);
      expect(accept(s, p).nextAccepted.map((t) => t.qty)).toEqual([need]);
    },
  );
  it('excludes an exactly smaller decimal value without epsilon or rounding', () => {
    const p = plan(network([3], 3, 0.099999999), settings(0.3));
    expect(p.transfers).toEqual([]);
    expect(p.exclusions[0]!.branchId).toBe('R0');
  });
  it('preserves full coverage across qualified recipients when surplus is insufficient', () => {
    const p = plan(network([12, 10, 8], 21), settings());
    expect(p.transfers).toEqual([]);
    expect(p.skippedSkus).toEqual([
      expect.objectContaining({
        neededQty: 22,
        deliverableQty: 21,
        missingQty: 1,
      }),
    ]);
  });
  it('excludes a small fractional need before evaluating whole-unit coverage', () => {
    const p = plan(network([10, 0.5], 10), settings());
    expect(p.transfers.map((t) => [t.toBranchId, t.qty])).toEqual([['R0', 10]]);
    expect(p.skippedSkus).toEqual([]);
  });
  it('uses configured target rather than full Max to evaluate the incoming value', () => {
    const s = network([20]);
    s.stocks[1]!.min = 0;
    const c = {
      ...settings(),
      recipientTrigger: 'BELOW_MAX' as const,
      receiverPct: 25,
    };
    expect(plan(s, c).transfers).toEqual([]); // target5, amount5000, Max20 must not qualify it.
    c.receiverPct = 50;
    expect(plan(s, c).transfers.map((t) => t.qty)).toEqual([10]);
  });
  it('applies threshold to remaining need after previous accepted input', () => {
    const s = network([15]),
      old: AcceptedTransfer = {
        transferId: 'old',
        sourceRunId: 'old',
        sourceLineId: 'old',
        skuCode: 'SKU1',
        fromBranchId: 'D',
        toBranchId: 'R0',
        qty: 6,
        snapshotId: s.snapshotId,
        acceptedAt: '2026-11-03T08:00:00Z',
        acceptedConfig: config(),
      };
    expect(plan(s, settings(), [old]).transfers).toEqual([]); // only9k remain.
    expect(plan(s, settings(9000), [old]).transfers.map((t) => t.qty)).toEqual([
      9,
    ]);
  });
  it('combines donors for one recipient, but not recipients', () => {
    const s = network([10], 6);
    s.branches.push({ id: 'D2', name: 'D2', active: true, aliases: [] });
    s.stocks.push({
      skuCode: 'SKU1',
      branchId: 'D2',
      stock: 104,
      min: 0,
      max: 100,
      sourceRow: 9,
    });
    const p = plan(s, settings());
    expect(p.transfers.map((t) => t.qty).sort()).toEqual([4, 6]);
    expect(
      accept(s, p)
        .nextAccepted.map((t) => t.qty)
        .sort(),
    ).toEqual([4, 6]);
    expect(() => accept(s, p, [], [p.transfers[0]!.sourceLineId])).toThrow(); // unchanged accepted-subset guard now scoped to recipient.
  });
  it('rechecks each recipient in the accepted subset even if another recipient covers the network sum', () => {
    const s = network([12, 10]),
      p = plan(s, settings());
    // Domain boundary must reject an incompatible/corrupted sub-threshold destination line.
    p.transfers.find((t) => t.toBranchId === 'R1')!.qty = 6;
    expect(() => accept(s, p)).toThrow();
  });
  it('does not warn at equality and identifies a single under-threshold recipient after revoke', () => {
    const s = network([10], 6);
    s.branches.push({ id: 'D2', name: 'D2', active: true, aliases: [] });
    s.stocks.push({
      skuCode: 'SKU1',
      branchId: 'D2',
      stock: 104,
      min: 0,
      max: 100,
      sourceRow: 9,
    });
    const p = plan(s, settings()),
      all = accept(s, p);
    expect(all.diagnostics).toEqual([]);
    const four = all.nextAccepted.find((t) => t.qty === 4)!;
    const out = revokeTransfers({
      snapshot: s,
      currentAccepted: all.nextAccepted,
      transferIds: [four.transferId],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(out.diagnostics).toEqual([
      expect.objectContaining({
        branchId: 'R0',
        amount: 6000,
        threshold: 10000,
      }),
    ]);
  });
  it('keeps saved economic warnings separate for recipients of the same SKU', () => {
    const s = network([6, 6]);
    const ledger = s.stocks
      .slice(1)
      .map(
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
  it('rejects new additions from a saved network-total proposal without deleting accepted history', () => {
    const s = network([10]),
      p = plan(s, settings());
    p.algorithmVersion = 'full-sku-network-flow-v3';
    expect(() => accept(s, p)).toThrow('STALE_PROPOSAL');
  });
  it('preserves unfiltered behavior and known zero at zero threshold', () => {
    expect(plan(network([6, 6]), config()).transfers).toHaveLength(2);
    expect(
      plan(network([1], 1, 0), settings(0)).transfers.map((t) => t.qty),
    ).toEqual([1]);
  });
});
