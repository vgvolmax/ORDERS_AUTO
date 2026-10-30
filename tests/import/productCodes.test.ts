import * as XLSX from 'xlsx';
import { expect, it } from 'vitest';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { readFirstSheetRows } from '../../src/import/workbook';
import { calculateDemand, priceDemand } from '../../src/domain/demand';
import { resolveSuppliers } from '../../src/domain/suppliers';

function report(rows: unknown[][], codeCell: string): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet[codeCell]!.z = '000000';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Report');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

it('retains visible numeric code zeros in both imports while quantities and prices stay numeric', () => {
  const min = report([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    [123, 'A-1', 'Товар', 1.5, 2, 10, 1000],
    [null, null, 'Ленина', 1.5, 2, 10, null],
  ], 'A2');
  const suppliers = report([
    ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
    ['ИП Баранов Роман Борисович', 123, 'Товар', 2, 2000, 'шт'],
  ], 'B2');
  const data = parseMinMaxWorkbook(min).data!;
  const history = parseSupplierWorkbook(suppliers).data!;
  expect(data.skus[0]!.code).toBe('000123');
  expect(history.history[0]!.skuCode).toBe('000123');
  expect(data.branchStocks[0]!.stock).toBe(1.5);
  expect(data.skus[0]!.referencePrice).toBe(1000);
  const priced = priceDemand(calculateDemand(data), data.skus, resolveSuppliers(history.history, [], ['000123']));
  expect(priced[0]!.selectedSupplier).toBe('ИП Баранов Роман Борисович');
  expect(priced[0]!.skuCode).toBe('000123');
});

it('keeps text code zeros and characters without applying a numeric format', () => {
  const rows = readFirstSheetRows(report([
    ['Код', 'Номенклатура'], ['000123-X', 'Товар'],
  ], 'A2'));
  expect(rows[1]![0]).toBe('000123-X');
});
