import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
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
});
