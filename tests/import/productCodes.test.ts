import * as XLSX from 'xlsx';
import { expect, it } from 'vitest';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { readFirstSheet } from '../../src/import/workbook';
import { calculateDemand, priceDemand } from '../../src/domain/demand';
import { resolveSuppliers } from '../../src/domain/suppliers';
import { compareInvoice } from '../../src/domain/invoices';
import { buildOrderProjection } from '../../src/domain/orders';

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

it('preserves a zero-masked article through MIN/MAX, orders and article-only invoice matching', () => {
  const data = parseMinMaxWorkbook(report([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    ['0001', 123, 'Товар', 0, null, null, 100],
    [null, null, 'Ленина', 0, 2, 10, null],
  ], 'B2')).data!;
  expect(data.skus[0]?.article).toBe('000123');
  const resolutions = resolveSuppliers([{
    skuCode: '0001', supplier: 'ИП Баранов Роман Борисович', skuName: 'Товар', unit: 'шт',
    purchaseQty: 1, purchaseAmount: 100, weightedUnitCost: 100,
  }], [], ['0001']);
  const { orders } = buildOrderProjection(priceDemand(calculateDemand(data), data.skus, resolutions),
    resolutions, [], { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' });
  expect(compareInvoice(orders, [{
    skuCode: null, article: '000123', name: 'Товар', quantity: 10,
    unit: 'шт', price: 100, amount: 1000, sourceRow: 2,
  }])).toMatchObject([{ skuCode: '0001', article: '000123', differences: [] }]);
});

it.each([
  ['000123-X', '000000', '000123-X'],
  [1234567890123, '0.00E+00', '1234567890123'],
  [123, '0.00', '123'],
])('reads article %s without rounding or inventing digits from %s', (article, format, expected) => {
  const data = parseMinMaxWorkbook(report([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток'],
    ['0001', article, 'Товар', 0, null, null],
    [null, null, 'Ленина', 0, 2, 10],
  ], 'B2', format)).data!;
  expect(data.skus[0]?.article).toBe(expected);
});

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
  const { readCode } = readFirstSheet(
    report(
      [
        ['Код', 'Номенклатура'],
        ['000123-X', 'Товар'],
      ],
      'A2',
    ),
  );
  expect(readCode(1, 0)).toBe('000123-X');
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

it.each(['Код товара', 'Код номенклатуры (1С)'])(
  'reads formatted codes from the recognized supplier header %s',
  (codeHeader) => {
    const result = parseSupplierWorkbook(
      report(
        [
          ['Контрагент', codeHeader, 'Номенклатура', 'Количество', 'Стоимость'],
          ['ИП Баранов Роман Борисович', 1, 'Товар', 2, 200],
        ],
        'B2',
      ),
    );

    expect(result.data?.history[0]?.skuCode).toBe('000001');
  },
);

it('uses the recognized MIN/MAX header after a metadata row containing Код', () => {
  const result = parseMinMaxWorkbook(
    report(
      [
        ['Вид отчёта', 'Код', 'MIN/MAX'],
        ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток'],
        [1, 'A', 'Товар', 1, 1, 10],
        [null, null, 'Ленина', 1, 1, 10],
      ],
      'A3',
    ),
  );

  expect(result.data?.skus[0]?.code).toBe('000001');
});
