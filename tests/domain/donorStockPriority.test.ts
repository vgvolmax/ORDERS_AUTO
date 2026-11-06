import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import { prioritizeDonorStock } from '../../src/domain/rebalancing/donorStockPriority';
import type { RebalanceConfig, RebalanceSnapshot } from '../../src/domain/rebalancing/types';
import { config } from '../fixtures/rebalanceFixtures';

function calculate(
  rows: Array<[id: string, stock: number, max: number]>,
  options: Partial<RebalanceConfig> = {},
  price = 100,
) {
  const snapshot: RebalanceSnapshot = {
    schemaVersion: 1,
    snapshotId: 'donor-priority',
    branches: rows.map(([id]) => ({ id, name: id, active: true, aliases: [] })),
    skus: [{ skuCode: 'SKU', name: 'SKU', unit: 'шт', quantityStep: 1, referencePrice: price }],
    stocks: rows.map(([branchId, stock, max]) => ({
      skuCode: 'SKU', branchId, stock, min: max, max, sourceRow: null,
    })),
  };
  return calculateRebalance(snapshot, config(options), []);
}

const lines = (result: ReturnType<typeof calculate>) =>
  result.transfers.map((t) => [t.fromBranchId, t.toBranchId, t.qty]);

describe('donor selection by stock remaining relative to Max', () => {
  it('uses the best relative reserve among donors able to supply the entire need', () => {
    const result = calculate([
      ['A-Раменское', 50, 30],
      ['B-Наро-Фоминск', 8, 3],
      ['C-Электросталь', 30, 5],
      ['Ленина', 0, 10],
    ]);
    expect(lines(result)).toEqual([['C-Электросталь', 'Ленина', 10]]);
  });

  it('covers 18 units in one qualifying line instead of losing two units to the amount filter', () => {
    const result = calculate(
      [['A-Егорьевск', 43, 30], ['B-Ленина', 87, 30], ['Орехово-Зуево', 12, 30]],
      { recipientTrigger: 'BELOW_MAX', transferAmountFilter: { enabled: true, threshold: 5000 } },
      412.95,
    );
    expect(lines(result)).toEqual([['B-Ленина', 'Орехово-Зуево', 18]]);
    expect(result.uncoveredNeed).toEqual([]);
  });

  it('covers a viable recipient even when another recipient cannot pass the threshold', () => {
    const result = calculate(
      [['A', 43, 30], ['B', 87, 30], ['X', 12, 30], ['Y', 19, 30]],
      {
        recipientTrigger: 'BELOW_MAX',
        transferAmountFilter: { enabled: true, threshold: 5000 },
        routeConfig: { mode: 'SELECTIVE', pairs: [
          { branchAId: 'A', branchBId: 'X', direction: 'A_TO_B' },
          { branchAId: 'A', branchBId: 'Y', direction: 'A_TO_B' },
          { branchAId: 'B', branchBId: 'X', direction: 'A_TO_B' },
        ] },
      },
      412.95,
    );
    expect(lines(result)).toEqual([['B', 'X', 18]]);
    expect(result.uncoveredNeed.map((need) => [need.branchId, need.toTarget]))
      .toEqual([['Y', 11]]);
  });

  it('keeps the donor that can serve a recipient with no other route available', () => {
    const result = calculate(
      [['A', 30, 5], ['B', 40, 30], ['X', 0, 10], ['Y', 0, 25]],
      {
        routeConfig: { mode: 'SELECTIVE', pairs: [
          { branchAId: 'A', branchBId: 'X', direction: 'A_TO_B' },
          { branchAId: 'A', branchBId: 'Y', direction: 'A_TO_B' },
          { branchAId: 'B', branchBId: 'X', direction: 'A_TO_B' },
        ] },
      },
    );
    expect(lines(result)).toEqual([['A', 'Y', 25], ['B', 'X', 10]]);
  });

  it('chooses a feasible split above the monetary minimum when no single donor suffices', () => {
    const result = calculate(
      [['A', 108, 100], ['B', 106, 100], ['R', 0, 10]],
      { transferAmountFilter: { enabled: true, threshold: 400 } },
    );
    expect(lines(result)).toEqual([['A', 'R', 6], ['B', 'R', 4]]);
    expect(result.uncoveredNeed).toEqual([]);
  });

  it('does not let the best relative reserve break monetary coverage for another recipient', () => {
    const result = calculate(
      [['A', 19, 1], ['B', 100, 90], ['C', 100, 92], ['X', 0, 10], ['Y', 0, 16]],
      {
        transferAmountFilter: { enabled: true, threshold: 900 },
        routeConfig: { mode: 'SELECTIVE', pairs: [
          { branchAId: 'A', branchBId: 'X', direction: 'A_TO_B' },
          { branchAId: 'A', branchBId: 'Y', direction: 'A_TO_B' },
          { branchAId: 'B', branchBId: 'X', direction: 'A_TO_B' },
          { branchAId: 'C', branchBId: 'Y', direction: 'A_TO_B' },
        ] },
      },
    );
    expect(lines(result)).toEqual([['A', 'Y', 16], ['B', 'X', 10]]);
  });

  it('prefers two whole shipments over three when recipients compete for the same donor', () => {
    expect(lines(calculate([
      ['A', 11, 1], ['B', 36, 30], ['X', 0, 6], ['Y', 0, 10],
    ]))).toEqual([['A', 'Y', 10], ['B', 'X', 6]]);
  });

  it('does not reserve stock for an impossible monetary route', () => {
    const result = calculate(
      [['A', 110, 100], ['B', 103, 100], ['R', 0, 10], ['Z', 0, 3]],
      {
        transferAmountFilter: { enabled: true, threshold: 400 },
        routeConfig: { mode: 'SELECTIVE', pairs: [
          { branchAId: 'A', branchBId: 'R', direction: 'A_TO_B' },
          { branchAId: 'B', branchBId: 'R', direction: 'A_TO_B' },
          { branchAId: 'A', branchBId: 'Z', direction: 'A_TO_B' },
        ] },
      },
    );
    expect(lines(result)).toEqual([['A', 'R', 10]]);
    expect(result.uncoveredNeed.map((need) => [need.branchId, need.toTarget]))
      .toEqual([['Z', 3]]);
  });

  it('releases the same reservation when the remaining stock cannot cover both recipients', () => {
    const result = calculate(
      [['A', 110, 100], ['R', 0, 10], ['Z', 0, 3]],
      { transferAmountFilter: { enabled: true, threshold: 400 } },
    );
    expect(lines(result)).toEqual([['A', 'R', 10]]);
    expect(result.uncoveredNeed.map((need) => [need.branchId, need.toTarget]))
      .toEqual([['Z', 3]]);
    expect(result.exclusions).toContainEqual(expect.objectContaining({
      code: 'TRANSFER_AMOUNT_FILTER', fromBranchId: 'A', toBranchId: 'Z', amount: 300,
    }));
  });

  it('covers six of seven recipients on the dense network without timing out', () => {
    const result = calculate(
      [
        ...Array.from({ length: 6 }, (_, i): [string, number, number] => ['D' + i, 49, 30]),
        ...Array.from({ length: 7 }, (_, i): [string, number, number] => ['R' + i, 0, 10]),
      ],
      { transferAmountFilter: { enabled: true, threshold: 600 } },
    );
    expect(result.transfers.filter((t) => t.qty === 10)).toHaveLength(6);
    expect(result.transfers.reduce((sum, t) => sum + t.qty, 0)).toBe(69);
    expect(result.exclusions.some((i) => i.code === 'TRANSFER_SEARCH_LIMIT')).toBe(false);
  }, 3000);

  it('keeps fifteen when twenty surplus cannot fully cover two recipients and ten is below the threshold', () => {
    const result = calculate(
      [['D', 120, 100], ['X', 0, 10], ['Y', 0, 15]],
      { transferAmountFilter: { enabled: true, threshold: 1100 } },
    );
    expect(lines(result)).toEqual([['D', 'Y', 15]]);
    expect(result.balances.find((b) => b.branchId === 'D')?.stockAfter).toBe(105);
    expect(result.uncoveredNeed).toEqual([{ skuCode: 'SKU', branchId: 'X', toMin: 10, toTarget: 10 }]);
    expect(result.skippedSkus).toEqual([expect.objectContaining({
      neededQty: 25, deliverableQty: 15, missingQty: 10,
      reason: 'AMOUNT_THRESHOLD',
    })]);
  });

  it('allows a partial receiver line above the threshold with one donor', () => {
    const result = calculate(
      [['D', 115, 100], ['R', 0, 20]],
      { transferAmountFilter: { enabled: true, threshold: 1100 } },
    );
    expect(lines(result)).toEqual([['D', 'R', 15]]);
    expect(result.uncoveredNeed.map((need) => need.toTarget)).toEqual([5]);
    expect(result.skippedSkus?.[0]).toMatchObject({
      neededQty: 20, deliverableQty: 15, missingQty: 5,
      reason: 'INSUFFICIENT_SURPLUS',
    });
  });

  it('combines two qualifying partial donor lines when neither can finish the recipient', () => {
    const result = calculate(
      [['A', 108, 100], ['B', 106, 100], ['R', 0, 20]],
      { transferAmountFilter: { enabled: true, threshold: 400 } },
    );
    expect(lines(result)).toEqual([['A', 'R', 8], ['B', 'R', 6]]);
    expect(result.uncoveredNeed.map((need) => need.toTarget)).toEqual([6]);
  });

  it('reports a stopped search and returns only legal lines when the budget is exhausted', () => {
    const donors = [
      { id: 'A', capacity: 8, stock: 108, max: 100, minimumUnits: 4 },
      { id: 'B', capacity: 6, stock: 106, max: 100, minimumUnits: 4 },
    ];
    const receivers = [{ id: 'R', targetNeed: 10, minNeed: 10, minDeficit: 10 }];
    const physical = [
      { from: 'A', to: 'R', units: 8 },
      { from: 'B', to: 'R', units: 2 },
    ];
    const allowed = new Map(donors.map((d) => [d.id, new Set(['R'])]));
    expect(prioritizeDonorStock(donors, receivers, allowed, 1, new Set(), physical, { remaining: 0 }))
      .toEqual({ lines: [physical[0]], limited: true });
  });
});
