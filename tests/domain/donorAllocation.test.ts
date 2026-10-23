import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import { rebalanceConfigFingerprint } from '../../src/domain/rebalancing/constraints';
import { acceptTransfers } from '../../src/domain/rebalancing/acceptedTransfers';
import {
  buildDonorAllocationModel,
  setDonorPriorities,
  setDonorQuantity,
  setDonorSplitMode,
  assertDonorPrioritiesReady,
} from '../../src/domain/rebalancing/allocationPlan';
import type {
  AcceptedTransfer,
  RebalanceProposal,
  RebalanceSnapshot,
} from '../../src/domain/rebalancing/types';
import { config } from '../fixtures/rebalanceFixtures';
function context(twoDonors = false) {
  const snapshot: RebalanceSnapshot = {
    schemaVersion: 1,
    snapshotId: 's',
    branches: ['D1', ...(twoDonors ? ['D2'] : []), 'R1', 'R2'].map((id) => ({
      id,
      name: id,
      active: true,
      aliases: [],
    })),
    skus: [
      {
        skuCode: '00001',
        name: 'Товар',
        unit: 'шт',
        quantityStep: 1,
        referencePrice: 100,
      },
    ],
    stocks: [
      {
        skuCode: '00001',
        branchId: 'D1',
        stock: 16,
        min: 1,
        max: 10,
        sourceRow: 1,
      },
      ...(twoDonors
        ? [
            {
              skuCode: '00001',
              branchId: 'D2',
              stock: 16,
              min: 1,
              max: 10,
              sourceRow: 2,
            },
          ]
        : []),
      {
        skuCode: '00001',
        branchId: 'R1',
        stock: 0,
        min: 1,
        max: 8,
        sourceRow: 3,
      },
      {
        skuCode: '00001',
        branchId: 'R2',
        stock: 0,
        min: 1,
        max: 4,
        sourceRow: 4,
      },
    ],
  };
  const c = config();
  const proposal: RebalanceProposal = {
    ...calculateRebalance(snapshot, c, []),
    runId: 'run',
    snapshotId: 's',
    createdAt: '2026-10-23T00:00:00Z',
    baseAcceptedRevision: 0,
    configFingerprint: rebalanceConfigFingerprint(c),
    config: c,
  };
  return { snapshot, proposal, accepted: [] as AcceptedTransfer[] };
}
const quantity = (p: RebalanceProposal, from: string, to: string) =>
  p.transfers
    .filter((t) => t.fromBranchId === from && t.toBranchId === to)
    .reduce((n, t) => n + t.qty, 0);
const change = (c: ReturnType<typeof context>, p: RebalanceProposal) => ({
  ...c,
  proposal: p,
});

describe('operator donor allocation', () => {
  it('requires an explicit decision for competing shortages but not for a single recipient', () => {
    const c = context(),
      row = buildDonorAllocationModel(c).find((r) => r.fromBranchId === 'D1')!;
    expect(row).toMatchObject({
      availableQty: 6,
      plannedQty: 6,
      after: 10,
      priorityRequired: true,
    });
    expect(row.cells.map((r) => r.need)).toEqual([8, 4]);
    expect(() =>
      assertDonorPrioritiesReady(
        c,
        c.proposal.transfers.map((t) => t.sourceLineId),
      ),
    ).toThrow('PRIORITIES_REQUIRED');
    c.snapshot.stocks = c.snapshot.stocks.filter((s) => s.branchId !== 'R2');
    c.proposal.eligibleRecipientKeys = c.proposal.eligibleRecipientKeys.filter(
      (k) => !k.includes('R2'),
    );
    c.proposal.transfers = c.proposal.transfers.filter(
      (t) => t.toBranchId !== 'R2',
    );
    expect(buildDonorAllocationModel(c)[0]!.priorityRequired).toBe(false);
  });
  it('sends all available only to the selected recipient, capped by need, leaving unused surplus', () => {
    const c = context(),
      before = structuredClone(c);
    const p = setDonorPriorities(c, '00001', 'D1', ['R2']);
    expect([quantity(p, 'D1', 'R1'), quantity(p, 'D1', 'R2')]).toEqual([0, 4]);
    expect(p.balances.find((b) => b.branchId === 'D1')!.stockAfter).toBe(12);
    expect(c).toEqual(before);
  });
  it('switches proportional4/2 to equal3/3 in the same donor and persists the mode', () => {
    const c = context();
    const p = setDonorPriorities(c, '00001', 'D1', ['R1', 'R2']);
    expect([quantity(p, 'D1', 'R1'), quantity(p, 'D1', 'R2')]).toEqual([4, 2]);
    const equal = setDonorSplitMode(change(c, p), 'D1', 'EQUAL');
    expect([quantity(equal, 'D1', 'R1'), quantity(equal, 'D1', 'R2')]).toEqual([
      3, 3,
    ]);
    expect(equal.allocationModes?.D1).toBe('EQUAL');
    expect(equal.allocationRevision).toBe(2);
    expect(() =>
      assertDonorPrioritiesReady(
        change(c, equal),
        equal.transfers.map((t) => t.sourceLineId),
      ),
    ).not.toThrow();
  });
  it('redistributes equal shares after a small recipient is saturated', () => {
    const c = context();
    c.snapshot.stocks.find((s) => s.branchId === 'R2')!.max = 1;
    const p = setDonorPriorities(
      change(c, setDonorSplitMode(c, 'D1', 'EQUAL')),
      '00001',
      'D1',
      ['R1', 'R2'],
    );
    expect([quantity(p, 'D1', 'R1'), quantity(p, 'D1', 'R2')]).toEqual([5, 1]);
  });
  it('reassigns other automatic donors instead of treating their proposals as committed incoming', () => {
    const c = context(true);
    const p = setDonorPriorities(c, '00001', 'D2', ['R1']);
    expect(quantity(p, 'D2', 'R1')).toBe(6);
    expect([quantity(p, 'D1', 'R1'), quantity(p, 'D1', 'R2')]).toEqual([2, 4]);
    expect(p.uncoveredNeed).toEqual([]);
    expect(
      buildDonorAllocationModel(change(c, p)).every((r) => !r.priorityRequired),
    ).toBe(true);
  });
  it('keeps manual quantities fixed when mode or other donor priorities change', () => {
    const c = context(true);
    let p = setDonorPriorities(c, '00001', 'D1', ['R2']);
    p = setDonorQuantity(change(c, p), '00001', 'D1', 'R2', 2);
    p = setDonorSplitMode(change(c, p), 'D1', 'EQUAL');
    expect(quantity(p, 'D1', 'R2')).toBe(2);
    p = setDonorPriorities(change(c, p), '00001', 'D2', ['R2']);
    expect([quantity(p, 'D1', 'R2'), quantity(p, 'D2', 'R2')]).toEqual([2, 2]);
    expect(p.balances.find((b) => b.branchId === 'D1')!.stockAfter).toBe(14);
  });
  it('rejects manual donor overdraw, recipient overflow, invalid steps and non-finite inputs without mutation', () => {
    const c = context(),
      before = structuredClone(c);
    for (const value of [7, -1, 0.5, NaN, Infinity])
      expect(() => setDonorQuantity(c, '00001', 'D1', 'R1', value)).toThrow();
    c.snapshot.stocks[0]!.stock = 30;
    expect(() => setDonorQuantity(c, '00001', 'D1', 'R2', 5)).toThrow();
    c.snapshot = before.snapshot;
    expect(c).toEqual(before);
  });
  it('respects original eligibility and blocked directed routes', () => {
    const c = context();
    c.proposal.config.routeConfig = {
      mode: 'SELECTIVE',
      pairs: [{ branchAId: 'D1', branchBId: 'R1', direction: 'A_TO_B' }],
    };
    c.proposal.configFingerprint = rebalanceConfigFingerprint(
      c.proposal.config,
    );
    expect(() => setDonorPriorities(c, '00001', 'D1', ['R2'])).toThrow();
    expect(() => setDonorQuantity(c, '00001', 'D1', 'D1', 1)).toThrow();
  });
  it('uses exact fractional steps and deterministic largest remainders', () => {
    const c = context();
    c.snapshot.skus[0]!.quantityStep = 0.25;
    c.snapshot.stocks[0]!.stock = 11.25;
    const p = setDonorPriorities(c, '00001', 'D1', ['R1', 'R2']);
    expect([quantity(p, 'D1', 'R1'), quantity(p, 'D1', 'R2')]).toEqual([
      0.75, 0.5,
    ]);
    expect(p.transfers.reduce((n, t) => n + t.qty, 0)).toBe(1.25);
  });
  it('enforces shortage readiness at actual acceptance and accepts edited concrete quantities after resolution', () => {
    const c = context();
    const args = {
      snapshot: c.snapshot,
      currentAccepted: [],
      currentProposal: c.proposal,
      selectedLineIds: c.proposal.transfers.map((t) => t.sourceLineId),
      currentRevision: 0,
      expectedRevision: 0,
      currentConfigFingerprint: c.proposal.configFingerprint,
      acceptedAt: c.proposal.createdAt,
      transferIdBySourceLineId: Object.fromEntries(
        c.proposal.transfers.map((t, i) => [t.sourceLineId, 'id' + i]),
      ),
    };
    expect(() => acceptTransfers(args)).toThrow('PRIORITIES_REQUIRED');
    const p = setDonorPriorities(c, '00001', 'D1', ['R2']);
    const t = p.transfers[0]!;
    const accepted = acceptTransfers({
      ...args,
      currentProposal: p,
      selectedLineIds: [t.sourceLineId],
      transferIdBySourceLineId: { [t.sourceLineId]: 'id' },
    }).nextAccepted;
    expect(accepted[0]!.qty).toBe(4);
    expect(() =>
      setDonorQuantity({ ...c, proposal: p, accepted }, '00001', 'D1', 'R2', 3),
    ).toThrow();
    const next = setDonorSplitMode(
      { ...c, proposal: p, accepted },
      'D1',
      'EQUAL',
    );
    expect(quantity(next, 'D1', 'R2')).toBe(4);
    expect(next.balances.find((b) => b.branchId === 'R2')!.stockAfter).toBe(4);
  });
});
