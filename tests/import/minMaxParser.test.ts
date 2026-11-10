import * as XLSX from 'xlsx';
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

const minMaxHeader = [
  'Код', 'Артикул', 'Номенклатура', 'Количество',
  'Минимальный остаток', 'Максимальный остаток', 'Цена',
];

it.each(['D3', 'E3', 'F3'])(
  'reports the Excel formula error in %s instead of accepting it as a blank',
  (address) => {
    const sheet = XLSX.utils.aoa_to_sheet([
      minMaxHeader,
      ['SKU1', 'A', 'Товар', null, null, null, 100],
      [null, null, 'Ленина', 0, 2, 5],
      [null, null, 'Ступино', null, 2, 5],
    ]);
    sheet[address] = { t: 'e', v: 7, f: '1/0' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'TDSheet');
    const result = parseMinMaxWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));

    expect(result.fatal).toBe(false);
    expect(result.data?.branches).toEqual(['Ленина', 'Ступино']);
    expect(result.data?.branchStocks).toEqual([
      { skuCode: 'SKU1', branch: 'Ступино', stock: 0, min: 2, max: 5 },
    ]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'INVALID_BRANCH_VALUES', skuCode: 'SKU1', branch: 'Ленина', row: 3,
    }));
  },
);

it('uses the same branch spelling for the registry, stocks and diagnostics across product blocks', () => {
  const result = parseMinMaxWorkbook(buildWorkbook([
    minMaxHeader,
    ['SKU1', 'A', 'Товар 1', null, null, null, 100],
    [null, null, 'Ленина', 0, 2, 5],
    ['SKU2', 'B', 'Товар 2', null, null, null, 100],
    [null, null, 'ЛЕНИНА', 0, 2, 5],
    [null, null, 'ЛЕНИНА', 0, 2, 5],
  ]));

  expect(result.data?.branches).toEqual(['Ленина']);
  expect(result.data?.branchStocks.map(({ branch }) => branch)).toEqual(['Ленина', 'Ленина']);
  expect(result.issues).toContainEqual(expect.objectContaining({
    code: 'DUPLICATE_SKU_BRANCH', skuCode: 'SKU2', branch: 'Ленина',
  }));
});
