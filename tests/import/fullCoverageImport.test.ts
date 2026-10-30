import { expect, it } from 'vitest';
import { buildWorkbook } from '../fixtures/workbookBuilders';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { createRebalanceSnapshot } from '../../src/import/rebalanceSnapshot';
import { calculateRebalance } from '../../src/domain/rebalancing';
import { config } from '../fixtures/rebalanceFixtures';

it.each([3, 4, 5])(
  'retains a source error for a known receiver with malformed column%s before certifying full coverage',
  (column) => {
    const bad: unknown[] = [null, null, 'R2', 0, 6, 6, null];
    bad[column] = 'bad';
    const parsed = parseMinMaxWorkbook(
      buildWorkbook([
        [
          'Код',
          'Артикул',
          'Номенклатура',
          'Количество',
          'Минимальный остаток',
          'Максимальный остаток',
          'Цена',
        ],
        ['sku', 'A', 'SKU', 18, 1, 10, 10],
        [null, null, 'D', 18, 10, 10, null],
        [null, null, 'R1', 0, 8, 8, null],
        bad,
        [null, null, 'Служебная подпись', 'not a stock', null, null, null],
        ['known', 'B', 'Other valid SKU', 6, 1, 6, 10],
        [null, null, 'R2', 6, 6, 6, null],
      ]),
    );
    expect(parsed.fatal).toBe(false);
    const snapshot = createRebalanceSnapshot({
      snapshotId: 'parsed',
      dataset: parsed.data!,
      sourceIssues: parsed.issues,
      branchRegistry: ['D', 'R1', 'R2'].map((id) => ({
        id,
        name: id,
        active: true,
        aliases: [],
      })),
      skuPolicies: ['sku', 'known'].map((skuCode) => ({
        skuCode,
        unit: 'шт',
        quantityStep: 1,
      })),
    });
    const result = calculateRebalance(snapshot.snapshot, config(), []);
    expect(result.transfers).toEqual([]);
    expect(result.exclusions).toContainEqual(
      expect.objectContaining({
        skuCode: 'sku',
        branchId: 'R2',
        code: 'INVALID_BRANCH_VALUES',
      }),
    );
    expect(parsed.issues.some((i) => i.branch === 'Служебная подпись')).toBe(
      false,
    );
  },
);

it.each([3, 4, 5])(
  'keeps a receiver known only in the saved registry when column%s is malformed',
  (column) => {
    const bad: unknown[] = [null, null, 'R2', 0, 5, 10, null];
    bad[column] = 'broken';
    const parsed = parseMinMaxWorkbook(
      buildWorkbook([
        [
          'Код',
          'Артикул',
          'Номенклатура',
          'Количество',
          'Минимальный остаток',
          'Максимальный остаток',
          'Цена',
        ],
        ['S', 'A', 'SKU', null, null, null, 100],
        [null, null, 'D', 30, 10, 10, null],
        [null, null, 'R1', 0, 5, 10, null],
        bad,
      ]),
      ['D', 'R1', 'R2'],
    );
    expect(parsed.fatal).toBe(false);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_BRANCH_VALUES',
        skuCode: 'S',
        branch: 'R2',
      }),
    );
    expect(parsed.data!.branches).toContain('R2');
    const registry = ['D', 'R1', 'R2'].map((id) => ({
      id,
      name: id,
      active: true,
      aliases: [],
    }));
    const snapshot = createRebalanceSnapshot({
      snapshotId: 'parsed',
      dataset: parsed.data!,
      sourceIssues: parsed.issues,
      branchRegistry: registry,
      skuPolicies: [{ skuCode: 'S', unit: 'шт', quantityStep: 1 }],
    });
    const result = calculateRebalance(snapshot.snapshot, config(), []);
    expect(result.transfers).toEqual([]);
    expect(result.exclusions).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_BRANCH_VALUES',
        skuCode: 'S',
        branchId: 'R2',
      }),
    );
  },
);

it('reports and retains a wholly malformed SKU block when its branch is known elsewhere', () => {
  const parsed = parseMinMaxWorkbook(
    buildWorkbook([
      [
        'Код',
        'Артикул',
        'Номенклатура',
        'Количество',
        'Минимальный остаток',
        'Максимальный остаток',
        'Цена',
      ],
      ['S', 'A', 'Broken SKU', null, null, null, 100],
      [null, null, 'R', 'broken', 5, 10, null],
      ['K', 'B', 'Valid SKU', 0, null, null, 100],
      [null, null, 'R', 0, 5, 10, null],
    ]),
  );
  expect(parsed.fatal).toBe(false);
  expect(parsed.data!.skus.map((s) => s.code)).toEqual(['S', 'K']);
  expect(parsed.issues).toContainEqual(
    expect.objectContaining({
      code: 'INVALID_BRANCH_VALUES',
      skuCode: 'S',
      branch: 'R',
      row: 3,
    }),
  );
  expect(parsed.data!.branchStocks.some((s) => s.skuCode === 'S')).toBe(false);
});

it('reports a new malformed branch with explicit norms without requiring a prior valid row', () => {
  const parsed = parseMinMaxWorkbook(
    buildWorkbook([
      [
        'Код',
        'Артикул',
        'Номенклатура',
        'Количество',
        'Минимальный остаток',
        'Максимальный остаток',
        'Цена',
      ],
      ['S', 'A', 'SKU', null, null, null, 100],
      [null, null, 'D', 30, 10, 10, null],
      [null, null, 'New receiver', 'broken', 5, 10, null],
    ]),
  );
  expect(parsed.issues).toContainEqual(
    expect.objectContaining({
      code: 'INVALID_BRANCH_VALUES',
      skuCode: 'S',
      branch: 'New receiver',
    }),
  );
  expect(parsed.data!.branches).toContain('New receiver');
});
