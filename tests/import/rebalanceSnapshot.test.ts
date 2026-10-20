import { describe, expect, it } from 'vitest';
import { createRebalanceSnapshot } from '../../src/import/rebalanceSnapshot';
import type { SnapshotAdapterInput } from '../../src/domain/rebalancing/types';
import { registry } from '../fixtures/rebalanceFixtures';

function input(): SnapshotAdapterInput {
  return {
    snapshotId: 's1', branchRegistry: registry(),
    skuPolicies: [{ skuCode: '00001', unit: 'шт', quantityStep: 1 }, { skuCode: '1', unit: 'м', quantityStep: 0.25 }],
    dataset: {
      branches: ['Донор', 'Получатель'],
      skus: ['00001', '1'].map((code) => ({ code, article: null, name: code, referencePrice: 1200, reportedTotalStock: null })),
      branchStocks: [
        { skuCode: '00001', branch: 'Донор', stock: 80, min: 20, max: 60 },
        { skuCode: '1', branch: 'Получатель', stock: 0.25, min: 2, max: 4 },
      ],
    },
  };
}

describe('current Min-Max to rebalancing adapter', () => {
  it('keeps 1C codes distinct and does not mutate imported records', () => {
    const data = input(); const before = structuredClone(data);
    const result = createRebalanceSnapshot(data);
    expect(result.issues).toEqual([]);
    expect(result.snapshot.skus.map((s) => s.skuCode)).toEqual(['00001', '1']);
    expect(result.snapshot.stocks.map((s) => s.stock)).toEqual([80, 0.25]);
    expect(data).toEqual(before);
    expect(result.snapshot.stocks[0]!.sourceRow).toBeNull();
  });
  it('resolves a renamed branch by its existing stable alias and reports ambiguity', () => {
    const data = input(); data.dataset.branchStocks[0]!.branch = '  СТАРЫЙ\u00a0ДОНОР ';
    expect(createRebalanceSnapshot(data).snapshot.stocks[0]!.branchId).toBe('D');
    data.branchRegistry[1]!.aliases.push('старый донор');
    const result = createRebalanceSnapshot(data);
    expect(result.issues.map((i) => i.code)).toContain('AMBIGUOUS_BRANCH_ALIAS');
    expect(result.snapshot.stocks.some((s) => s.skuCode === '00001')).toBe(false);
  });
  it('skips only invalid rows and keeps their input provenance', () => {
    const data = input(); data.dataset.branchStocks[0]!.min = null;
    data.sourceRows = [{ skuCode: '00001', branch: 'Донор', row: 17 }];
    const result = createRebalanceSnapshot(data);
    expect(result.snapshot.stocks).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_NORM', sourceRow: 17 }));
  });
  it('excludes all duplicate rows and missing policies without silently assuming one piece', () => {
    const data = input(); data.dataset.branchStocks.push({ ...data.dataset.branchStocks[0]!, stock: 10 });
    const result = createRebalanceSnapshot(data);
    expect(result.snapshot.stocks).toHaveLength(1);
    data.skuPolicies = [];
    expect(createRebalanceSnapshot(data).snapshot.stocks).toEqual([]);
  });
  it('does not resurrect parser-reported duplicate rows already removed from the dataset', () => {
    const data = input(); data.sourceIssues = [{ severity: 'ERROR', code: 'DUPLICATE_SKU_BRANCH', message: 'duplicate', skuCode: '00001', branch: 'Донор', row: 17 }];
    const result = createRebalanceSnapshot(data);
    expect(result.snapshot.stocks.map((s) => s.skuCode)).toEqual(['1']);
    expect(result.issues.map((i) => i.code)).toContain('DUPLICATE_SKU_BRANCH');
  });
  it('reports unknown branch instead of making a new identity or dropping it silently', () => {
    const data = input(); data.dataset.branchStocks[0]!.branch = 'Неизвестный';
    const result = createRebalanceSnapshot(data);
    expect(result.issues.map((i) => i.code)).toContain('UNKNOWN_BRANCH');
    expect(result.snapshot.branches.map((b) => b.id)).toEqual(['D', 'R']);
  });
});
