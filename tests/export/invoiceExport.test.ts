import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildInvoiceAdjustments, compareInvoice, type InvoiceAdjustment, type InvoiceComparisonRow } from '../../src/domain/invoices';
import type { Order } from '../../src/domain/types';
import { invoiceAdjustmentCsv, invoiceAdjustmentTsv, invoiceAdjustmentWorkbook, invoiceComparisonCsv } from '../../src/export/invoiceExport';
import { parseInvoiceWorkbook } from '../../src/import/invoiceParser';

const adjustment: InvoiceAdjustment = {
  id: 'o', skuCode: '0007', article: '00123', name: 'Товар; "А"', unit: 'шт',
  qty: 1.25, price: 2.4, amount: 2.99, included: true,
};
const excluded = { ...adjustment, id: '2', article: 'Лишнее', included: false };

describe('invoice exports', () => {
  it('exports the actual order amount and the signed invoice difference independently of price tolerance', () => {
    const row = {
      id: 'o', skuCode: '0007', article: 'A', name: 'Товар', unit: 'шт',
      orderQty: 10000, invoiceQty: 10000, orderPrice: 100, invoicePrice: 100.01,
      orderAmount: 1000000, invoiceAmount: 1000100, differences: [], notes: [],
    } satisfies InvoiceComparisonRow;
    const csv = invoiceComparisonCsv([row]);
    expect(csv).toContain('Сумма заказа;Сумма счёта;Разница суммы');
    expect(csv).toContain(';1000000;1000100;100;');
    expect(csv).toContain('Разница суммы;0007;');
    expect(csv).not.toContain('Совпадает;');
  });
  it('keeps MIN/MAX order in the report and all 1C formats across branches', () => {
    const orders: Order[] = ['0007', '0003'].map((skuCode, index) => ({
      id: String(index), branch: `Склад ${index}`, supplier: 'Поставщик',
      totalQty: 1, totalAmount: 10, belowThreshold: false, status: 'READY', blockers: [],
      lines: [{
        skuCode, article: `A${skuCode}`, name: `Товар ${skuCode}`, branch: `Склад ${index}`, supplier: 'Поставщик',
        calculatedQty: 1, orderQty: 1, unit: 'шт', unitPrice: 10, priceSource: 'MIN_MAX',
        amount: 10, warnings: [], stock: 0, min: 1, max: 1,
      }],
    }));
    const items = ['0001', '0007', '0003', '0002'].map((skuCode, index) => ({
      skuCode, article: `A${skuCode}`, name: `Товар ${skuCode}`, quantity: 1,
      unit: 'шт', price: 10, amount: 10, sourceRow: index + 2,
    }));
    const rows = compareInvoice(orders, items, ['0003', '0002', '0007']);
    expect(invoiceComparisonCsv(rows).trim().split('\r\n').slice(1).map((row) => row.split(';')[1])).toEqual([
      '0003', '0002', '0007', '0001',
    ]);

    const corrections = buildInvoiceAdjustments(rows, 'invoice').map((row) =>
      row.skuCode === '0001' ? { ...row, included: true } : row,
    );
    const expectedArticles = ['A0003', 'A0007', 'A0001'];
    expect(invoiceAdjustmentCsv(corrections).trim().split('\r\n').slice(1).map((row) => row.split(';')[0])).toEqual(expectedArticles);
    expect(invoiceAdjustmentTsv(corrections).split('\n').slice(1).map((row) => row.split('\t')[0])).toEqual(expectedArticles);
    const book = XLSX.read(invoiceAdjustmentWorkbook(corrections), { type: 'array' });
    const cells = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 });
    expect(cells.slice(1).map((row) => row[0])).toEqual(expectedArticles);
  });

  it('exports included adjustments for 1C with decimal commas in text and no SKU code column', () => {
    expect(invoiceAdjustmentTsv([adjustment, excluded])).toBe(
      'Артикул\tНоменклатура\tКоличество\tЕд.\tЦена\tСумма\n00123\tТовар; "А"\t1,25\tшт\t2,4\t2,99',
    );
    expect(invoiceAdjustmentCsv([adjustment, excluded])).toContain(
      '00123;"Товар; ""А""";1,25;шт;2,4;2,99',
    );
    expect(invoiceAdjustmentCsv([adjustment, excluded])).not.toContain('Лишнее');
  });

  it('writes a true BIFF8 workbook with numeric values and a text article', () => {
    const bytes = invoiceAdjustmentWorkbook([adjustment, excluded]);
    expect([...new Uint8Array(bytes).slice(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
    const book = XLSX.read(bytes, { type: 'array' });

    expect(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]!]!, { header: 1 })).toEqual([
      ['Артикул', 'Номенклатура', 'Количество', 'Ед.', 'Цена', 'Сумма'],
      ['00123', 'Товар; "А"', 1.25, 'шт', 2.4, 2.99],
    ]);
  });

  it('includes concurrent difference labels and comments in the comparison CSV', () => {
    const row: InvoiceComparisonRow = {
      id: 'o', skuCode: '0007', article: '00123', name: 'Товар', unit: 'шт',
      orderQty: 1, invoiceQty: 2, orderPrice: 2, invoicePrice: 3, orderAmount: 2, invoiceAmount: 6,
      differences: ['quantity', 'higher'], notes: ['Проверить'],
    };
    expect(invoiceComparisonCsv([row])).toMatch(/Количество.*Дороже.*0007.*Проверить/);
  });
});

it('treats formulas in source text as text and leaves negative numbers numeric', () => {
  const dangerous = { ...adjustment, article: '=2+2', name: '\t+1', price: -2.4 };
  expect(invoiceAdjustmentCsv([dangerous])).toContain("'=2+2;' +1;1,25;шт;-2,4;2,99");
  expect(invoiceAdjustmentTsv([dangerous])).toContain("'=2+2\t' +1\t1,25\tшт\t-2,4\t2,99");

  const book = XLSX.read(invoiceAdjustmentWorkbook([dangerous]), { type: 'array' });
  const data = book.Sheets[book.SheetNames[0]!]!;
  expect(data.A2).toMatchObject({ t: 's', v: '=2+2' });
});

it('exports the full invoice value when the only adjacent sum is a VAT amount', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Артикул', 'Количество', 'Цена с НДС', 'Итого НДС'],
    ['B-7', 2, 120, 40],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Счёт');
  const parsed = parseInvoiceWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const correction = buildInvoiceAdjustments(compareInvoice([], parsed.items), 'invoice');

  expect(invoiceAdjustmentTsv(correction.map((row) => ({ ...row, included: true })))).toContain('120\t240');
});

it.each([invoiceAdjustmentCsv, invoiceAdjustmentTsv, invoiceAdjustmentWorkbook])(
  'rejects a correction when two included positions share the same exported identity',
  (exportCorrection) => {
    const collision = { ...adjustment, id: 'another', skuCode: '0008', qty: 2.5 };
    expect(() => exportCorrection([adjustment, collision])).toThrow(/неразличим/i);
    expect(() => exportCorrection([adjustment, { ...collision, included: false }])).not.toThrow();
  },
);
