import { describe, expect, it } from 'vitest';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { buildWorkbook } from '../fixtures/workbookBuilders';

describe('parseSupplierWorkbook real 1C hierarchical layout', () => {
  it('parses split two-row headers, shared supplier/name column, and skips hierarchy groups', () => {
    const result = parseSupplierWorkbook(
      buildWorkbook(
        [
          [null, 'Закупки'],
          [null, 'Период: Период не установлен'],
          [null, 'Показатели: Количество (в ед. хранения; Стоимость;'],
          [null, 'Группировки строк: Контрагент (Иерархия); Номенклатура (Иерархия);'],
          [],
          [],
          [],
          [null, null, 'Контрагент', 'Количество (в ед. хранения', 'Стоимость'],
          [null, 'Код', 'Номенклатура, Базовая единица измерения'],
          [],
          [null, null, 'Поставщики', 100, 10_000],
          [null, null, 'Поставщик А', 5, 550],
          [null, 1698, 'ВОДОНАГРЕВАТЕЛИ, ', 5, 550],
          [null, 'GROUP1', 'Колонки газовые BAXI, ', 5, 550],
          [null, 'SKU1', 'Колонка газовая SIG-2 11p BAXI, шт', 2, 220],
          [null, 'SKU1', 'Колонка газовая SIG-2 11p BAXI, шт', 3, 330],
          [null, null, 'Поставщик Б', 1, 120],
          [null, 'SKU1', 'Колонка газовая SIG-2 11p BAXI, шт', 1, 120],
        ],
        'xls',
      ),
    );

    expect(result.fatal).toBe(false);
    expect(result.data?.history).toHaveLength(2);
    expect(result.data?.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supplier: 'Поставщик А',
          skuCode: 'SKU1',
          skuName: 'Колонка газовая SIG-2 11p BAXI',
          unit: 'шт',
          purchaseQty: 5,
          purchaseAmount: 550,
          weightedUnitCost: 110,
        }),
        expect.objectContaining({
          supplier: 'Поставщик Б',
          skuCode: 'SKU1',
          purchaseQty: 1,
          purchaseAmount: 120,
          weightedUnitCost: 120,
        }),
      ]),
    );
    expect(result.data?.history.some((line) => line.skuCode === 'GROUP1')).toBe(false);
    expect(result.data?.history.some((line) => line.supplier === 'Поставщики')).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('MULTIPLE_SUPPLIERS');
  });
});
