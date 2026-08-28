import { describe, expect, it } from 'vitest';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { buildSupplierFixture, buildWorkbook } from '../fixtures/workbookBuilders';

describe('parseSupplierWorkbook', () => {
  it.each(['xls', 'xlsx'] as const)('parses grouped %s reports and aggregates supplier + SKU', (bookType) => {
    const result = parseSupplierWorkbook(buildSupplierFixture(bookType));
    const item = result.data?.history.find(
      (line) => line.supplier === 'Поставщик А' && line.skuCode === 'SKU1',
    );

    expect(result.fatal).toBe(false);
    expect(item?.purchaseQty).toBe(5);
    expect(item?.purchaseAmount).toBe(550);
    expect(item?.weightedUnitCost).toBe(110);
  });

  it('supports flat supplier layout and ignores total rows', () => {
    const result = parseSupplierWorkbook(
      buildWorkbook([
        ['Поставщик', 'Код номенклатуры', 'Товар', 'Кол-во', 'Сумма', 'Единица'],
        ['Поставщик А', 'SKU1', 'Товар 1', 2, 200, 'шт'],
        ['Поставщик А', 'SKU1', 'Товар 1', 1, 100, 'шт'],
        ['Всего', null, null, 3, 300, null],
      ]),
    );

    expect(result.data?.history).toHaveLength(1);
    expect(result.data?.history[0]?.purchaseQty).toBe(3);
  });

  it('warns about multiple suppliers for one SKU and conflicting units', () => {
    const result = parseSupplierWorkbook(
      buildWorkbook([
        ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
        ['Поставщик А', 'SKU1', 'Товар 1', 2, 200, 'шт'],
        ['Поставщик А', 'SKU1', 'Товар 1', 1, 100, 'уп'],
        ['Поставщик Б', 'SKU1', 'Товар 1', 1, 120, 'шт'],
      ]),
    );

    expect(result.issues.map((issue) => issue.code)).toContain('MIXED_UNITS');
    expect(result.issues.map((issue) => issue.code)).toContain('MULTIPLE_SUPPLIERS');
    expect(result.data?.history.find((line) => line.supplier === 'Поставщик А')?.unit).toBeNull();
  });
});
