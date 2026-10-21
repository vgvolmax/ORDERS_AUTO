import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import type { RebalanceSnapshot } from '../../src/domain/rebalancing/types';
import { config } from '../fixtures/rebalanceFixtures';

function network(min1: number, min2: number): RebalanceSnapshot {
  return { schemaVersion: 1, snapshotId: 'network', branches: ['D1', 'D2', 'R1', 'R2'].map((id) => ({ id, name: id, active: true, aliases: [] })),
    skus: [{ skuCode: '00001', name: 'SKU', unit: 'шт', quantityStep: 1, referencePrice: 100 }],
    stocks: [
      { skuCode: '00001', branchId: 'D1', stock: 11, min: 10, max: 10, sourceRow: 1 },
      { skuCode: '00001', branchId: 'D2', stock: 12, min: 10, max: 10, sourceRow: 2 },
      { skuCode: '00001', branchId: 'R1', stock: 0, min: min1, max: 2, sourceRow: 3 },
      { skuCode: '00001', branchId: 'R2', stock: 0, min: min2, max: 2, sourceRow: 4 },
    ] };
}
const endpoints = [['D1', 'R1'], ['D1', 'R2'], ['D2', 'R1'], ['D2', 'R2']] as const;

describe('network flow with Min coverage before target coverage', () => {
  it('maximizes actual Min coverage instead of spending a whole step on a smaller shortage', () => {
    const s = network(0.1, 1);
    s.stocks[0]!.stock = 11; s.stocks[1]!.stock = 10;
    s.stocks[2]!.max = 10; s.stocks[3]!.max = 1;
    const result = calculateRebalance(s, config(), []);
    expect(result.transfers.map((t) => [t.fromBranchId, t.toBranchId, t.qty])).toEqual([['D1', 'R2', 1]]);
    expect(result.uncoveredNeed.find((n) => n.branchId === 'R1')!.toMin).toBe(0.1);
    expect(result.uncoveredNeed.some((n) => n.branchId === 'R2')).toBe(false);
  });
  it('matches an independent exhaustive oracle on 1024 fractional networks for three quantity steps', () => {
    for (const step of [0.1, 1, 2.5]) for (let mask = 0; mask < 16; mask++)
      for (const min1 of [0.25, 0.5, 1, 1.5]) for (const min2 of [0.25, 0.5, 1, 1.5])
        for (const max1 of [2, 4]) for (const max2 of [2, 4]) {
          let bestMin = 0, bestTotal = 0;
          for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) for (let d = 0; d <= 1; d++) for (let e = 0; e <= 1; e++) {
            const values = [a, b, d, e];
            if (values.some((v, i) => v > 0 && !(mask & (1 << i))) || a + b > 1 || d + e > 1 || a + d > max1 || b + e > max2) continue;
            const covered = Math.min(a + d, min1) + Math.min(b + e, min2), total = a + b + d + e;
            if (covered > bestMin || (covered === bestMin && total > bestTotal)) { bestMin = covered; bestTotal = total; }
          }
          const s = network(min1 * step, min2 * step); s.skus[0]!.quantityStep = step;
          s.stocks.slice(0, 2).forEach((row) => { row.stock = 11 * step; row.min = row.max = 10 * step; });
          s.stocks[2]!.max = max1 * step; s.stocks[3]!.max = max2 * step;
          const pairs = endpoints.flatMap(([branchAId, branchBId], i) => mask & (1 << i) ? [{ branchAId, branchBId, direction: 'A_TO_B' as const }] : []);
          const result = calculateRebalance(s, config({ routeConfig: { mode: 'SELECTIVE', pairs } }), []);
          const incoming = (id: string) => result.transfers.filter((t) => t.toBranchId === id).reduce((sum, t) => sum + t.qty / step, 0);
          const r1 = incoming('R1'), r2 = incoming('R2'), context = `step=${step} mask=${mask} min=${min1}/${min2} max=${max1}/${max2}`;
          expect(Math.min(r1, min1) + Math.min(r2, min2), context).toBeCloseTo(bestMin, 12);
          expect(r1 + r2, context).toBeCloseTo(bestTotal, 12);
        }
  });
  it('reroutes an early donor allocation instead of freezing a greedy decision', () => {
    const s = network(1, 0); s.stocks[0]!.stock = 11; s.stocks[1]!.stock = 11; s.stocks[2]!.max = 1; s.stocks[3]!.max = 1;
    const c = config({ recipientTrigger: 'BELOW_MAX', routeConfig: { mode: 'SELECTIVE', pairs: [
      { branchAId: 'D1', branchBId: 'R1', direction: 'A_TO_B' },
      { branchAId: 'D1', branchBId: 'R2', direction: 'A_TO_B' },
      { branchAId: 'D2', branchBId: 'R1', direction: 'A_TO_B' },
    ] } });
    expect(calculateRebalance(s, c, []).transfers.map((t) => [t.fromBranchId, t.toBranchId, t.qty])).toEqual([['D1', 'R2', 1], ['D2', 'R1', 1]]);
  });
  it('matches independently enumerated lexicographic optima on all 144 small network cases', () => {
    for (let mask = 0; mask < 16; mask++) for (let min1 = 0; min1 <= 2; min1++) for (let min2 = 0; min2 <= 2; min2++) {
      let bestMin = 0, bestTotal = 0;
      for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) for (let d = 0; d <= 2; d++) for (let e = 0; e <= 2; e++) {
        const values = [a, b, d, e];
        if (values.some((v, i) => v > 0 && !(mask & (1 << i))) || a + b > 1 || d + e > 2 || a + d > 2 || b + e > 2) continue;
        const coveredMin = Math.min(a + d, min1) + Math.min(b + e, min2), total = a + b + d + e;
        if (coveredMin > bestMin || (coveredMin === bestMin && total > bestTotal)) { bestMin = coveredMin; bestTotal = total; }
      }
      const pairs = endpoints.flatMap(([branchAId, branchBId], i) => mask & (1 << i) ? [{ branchAId, branchBId, direction: 'A_TO_B' as const }] : []);
      const output = calculateRebalance(network(min1, min2), config({ recipientTrigger: 'BELOW_MAX', routeConfig: { mode: 'SELECTIVE', pairs } }), []);
      const r1 = output.transfers.filter((t) => t.toBranchId === 'R1').reduce((n, t) => n + t.qty, 0);
      const r2 = output.transfers.filter((t) => t.toBranchId === 'R2').reduce((n, t) => n + t.qty, 0);
      expect([Math.min(r1, min1) + Math.min(r2, min2), r1 + r2], `mask=${mask} min=${min1}/${min2}`).toEqual([bestMin, bestTotal]);
    }
  });
});
