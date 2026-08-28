import { describe, expect, it } from 'vitest';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { buildMinMaxFixture, buildWorkbook } from '../fixtures/workbookBuilders';

describe('parseMinMaxWorkbook', () => {
  it('ignores coded group rows and reads branch rows as source of truth', () => {
    const result = parseMinMaxWorkbook(buildMinMaxFixture());

    expect(result.fatal).toBe(false);
    expect(result.data?.skus.map((sku) => sku.code)).toEqual(['SKU1', 'SKU2']);
    expect(result.data?.branches).toEqual(['Ленина', 'Ступино']);
    expect(
      result.data?.branchStocks.find(
        (line) => line.skuCode === 'SKU1' && line.branch === 'Ступино',
      )?.stock,
    ).toBe(0);
  });

  it('keeps blank MAX as null and preserves leading zero codes', () => {
    const workbook = buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ['00123', 'A', 'Товар', 1, 2, null, 10],
      [null, null, 'Ленина', 1, 2, null, null],
    ]);

    const result = parseMinMaxWorkbook(workbook);
    expect(result.data?.skus[0]?.code).toBe('00123');
    expect(result.data?.branchStocks[0]?.max).toBeNull();
  });

  it('reports duplicate branch, invalid norm, total mismatch and missing reference price', () => {
    const workbook = buildWorkbook([
      ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
      ['SKU1', 'A', 'Товар', 99, 5, 4, null],
      [null, null, 'Ленина', 1, 5, 4, null],
      [null, null, 'Ленина', 2, 5, 4, null],
    ]);

    const result = parseMinMaxWorkbook(workbook);
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).toContain('DUPLICATE_SKU_BRANCH');
    expect(codes).toContain('INVALID_NORM');
    expect(codes).toContain('TOTAL_STOCK_MISMATCH');
    expect(codes).toContain('MISSING_REFERENCE_PRICE');
  });
});
