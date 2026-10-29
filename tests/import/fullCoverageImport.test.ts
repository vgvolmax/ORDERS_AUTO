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
