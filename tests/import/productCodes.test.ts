import * as XLSX from 'xlsx';
import { expect, it } from 'vitest';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { readFirstSheetRows } from '../../src/import/workbook';
import { calculateDemand, priceDemand } from '../../src/domain/demand';
import { resolveSuppliers } from '../../src/domain/suppliers';

function report(
  rows: unknown[][],
  codeCell: string,
  format = '000000',
): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet[codeCell]!.z = format;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Report');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

it('retains visible numeric code zeros in both imports while quantities and prices stay numeric', () => {
  const min = report(
    [
      [
        'Код',
        'Артикул',
        'Номенклатура',
        'Количество',
        'Минимальный остаток',
        'Максимальный остаток',
        'Цена',
      ],
      [123, 'A-1', 'Товар', 1.5, 2, 10, 1000],
      [null, null, 'Ленина', 1.5, 2, 10, null],
    ],
    'A2',
  );
  const suppliers = report(
    [
      [
        'Контрагент',
        'Код',
        'Номенклатура',
        'Количество',
        'Стоимость',
        'Ед. изм.',
      ],
      ['ИП Баранов Роман Борисович', 123, 'Товар', 2, 2000, 'шт'],
    ],
    'B2',
  );
  const data = parseMinMaxWorkbook(min).data!;
  const history = parseSupplierWorkbook(suppliers).data!;
  expect(data.skus[0]!.code).toBe('000123');
  expect(history.history[0]!.skuCode).toBe('000123');
  expect(data.branchStocks[0]!.stock).toBe(1.5);
  expect(data.skus[0]!.referencePrice).toBe(1000);
  const priced = priceDemand(
    calculateDemand(data),
    data.skus,
    resolveSuppliers(history.history, [], ['000123']),
  );
  expect(priced[0]!.selectedSupplier).toBe('ИП Баранов Роман Борисович');
  expect(priced[0]!.skuCode).toBe('000123');
});

it('keeps text code zeros and characters without applying a numeric format', () => {
  const rows = readFirstSheetRows(
    report(
      [
        ['Код', 'Номенклатура'],
        ['000123-X', 'Товар'],
      ],
      'A2',
    ),
  );
  expect(rows[1]![0]).toBe('000123-X');
});

it.each(['General', '0.00E+00'])(
  'preserves all digits and distinguishes safe integer codes with %s formatting',
  (format) => {
    const rows: unknown[][] = [
      [
        'Код',
        'Артикул',
        'Номенклатура',
        'Количество',
        'Минимальный остаток',
        'Максимальный остаток',
        'Цена',
      ],
      [1234567890123, 'A', 'First', 0, null, null, 100],
      [null, null, 'Ленина', 0, 1, 10, null],
      [1234567890124, 'B', 'Second', 0, null, null, 100],
      [null, null, 'Ленина', 0, 1, 10, null],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet.A2!.z = format;
    sheet.A4!.z = format;
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Data');
    const parsed = parseMinMaxWorkbook(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }),
    );
    expect(parsed.data!.skus.map((s) => s.code)).toEqual([
      '1234567890123',
      '1234567890124',
    ]);
    const supplier = parseSupplierWorkbook(
      report(
        [
          [
            'Контрагент',
            'Код',
            'Номенклатура',
            'Количество',
            'Стоимость',
            'Ед. изм.',
          ],
          ['ИП Баранов Роман Борисович', 1234567890123, 'First', 1, 100, 'шт'],
        ],
        'B2',
        format,
      ),
    );
    expect(supplier.data!.history[0]!.skuCode).toBe('1234567890123');
  },
);
