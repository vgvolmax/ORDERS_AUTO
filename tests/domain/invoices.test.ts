import { describe, expect, it } from 'vitest';
import { adjustmentAmount, buildInvoiceAdjustments, compareInvoice, type InvoiceItem } from '../../src/domain/invoices';
import type { Order, OrderLine } from '../../src/domain/types';

const line = (overrides: Partial<OrderLine> = {}): OrderLine => ({
  skuCode: '0007', article: 'A-123', name: 'Товар', branch: 'Склад', supplier: 'Поставщик',
  calculatedQty: 3, orderQty: 3, unit: 'шт', unitPrice: 10, priceSource: 'SUPPLIER_HISTORY',
  amount: 30, warnings: [], stock: 0, min: 0, max: 3, ...overrides,
});

const order = (...lines: OrderLine[]): Order => ({
  id: 'o', branch: 'Склад', supplier: 'Поставщик', lines, totalQty: 3, totalAmount: 30,
  belowThreshold: false, status: 'READY', blockers: [],
});

const invoice = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  skuCode: null, article: 'A-123', name: 'Товар', quantity: 3, unit: 'шт.',
  price: 10, amount: 30, sourceRow: 2, ...overrides,
});

describe('compareInvoice', () => {
  it('uses an explicit 1C code before the article and preserves leading zeros', () => {
    const rows = compareInvoice([order(line(), line({ skuCode: '7', article: 'B-345' }))], [
      invoice({ skuCode: '0007', article: 'B-345' }),
      invoice({ skuCode: '007', article: 'B-345', sourceRow: 3 }),
    ]);

    expect(rows).toMatchObject([
      { skuCode: '0007', invoiceQty: 3, differences: [] },
      { skuCode: '7', invoiceQty: null, differences: ['missing'] },
      { skuCode: '007', orderQty: null, differences: ['extra'] },
    ]);
  });

  it('does not allocate an article shared by distinct SKU codes', () => {
    const rows = compareInvoice([order(line(), line({ skuCode: '0008' }))], [invoice()]);

    expect(rows).toMatchObject([
      { skuCode: '0007', invoiceQty: null, differences: ['ambiguous'] },
      { skuCode: '0008', invoiceQty: null, differences: ['ambiguous'] },
      { skuCode: null, invoiceQty: 3, differences: ['ambiguous'] },
    ]);
  });

  it('assigns an unambiguous article token and does not match a name or a shared prefix alone', () => {
    const rows = compareInvoice([
      order(line({ article: 'ABC123' }), line({ skuCode: '0008', article: 'SET-499' })),
    ], [invoice({ article: 'Вариант ABC123' }), invoice({ article: 'SET-555', sourceRow: 3 })]);

    expect(rows).toMatchObject([
      { skuCode: '0007', invoiceQty: 3, differences: [] },
      { skuCode: '0008', invoiceQty: null, differences: ['missing'] },
      { article: 'SET-555', differences: ['extra'] },
    ]);
  });

  it('combines compatible duplicates, retaining exact amounts and all simultaneous differences', () => {
    const rows = compareInvoice([order(line(), line({ orderQty: 1, unitPrice: 12, amount: 12 }))], [
      invoice({ quantity: 2, price: 11, amount: 21.99 }),
      invoice({ quantity: 3, price: 13, amount: 39.02, sourceRow: 3 }),
    ]);

    expect(rows).toMatchObject([{
      orderQty: 4, invoiceQty: 5, orderPrice: 10.5, invoicePrice: 12.2,
      invoiceAmount: 61.01, differences: ['quantity', 'higher'],
    }]);
  });

  it('keeps incompatible invoice units visible in separate rows without duplicating the order', () => {
    const rows = compareInvoice([order(line())], [
      invoice(), invoice({ quantity: 1, unit: 'упак', sourceRow: 3 }),
    ]);

    expect(rows).toMatchObject([
      { orderQty: 3, invoiceQty: 3, differences: [] },
      { orderQty: null, invoiceQty: 1, unit: 'упак', differences: ['unit'] },
    ]);
  });

  it('does not treat an exact cent or quantity epsilon as a discrepancy', () => {
    const rows = compareInvoice([order(line({ unitPrice: 1, amount: 3 }))], [
      invoice({ quantity: 3.0001, price: 1.01, amount: 3.03 }),
    ]);
    expect(rows[0]?.differences).toEqual([]);
  });

  it('keeps an invoice price unknown when only some duplicate quantities have a price', () => {
    const rows = compareInvoice([order(line())], [
      invoice({ quantity: 2 }), invoice({ quantity: 1, price: null, amount: null, sourceRow: 3 }),
    ]);
    expect(rows[0]).toMatchObject({ invoiceQty: 3, invoicePrice: null, invoiceAmount: null, differences: ['unpriced'] });
    expect(buildInvoiceAdjustments(rows, 'invoice')[0]?.included).toBe(false);
  });
});

describe('buildInvoiceAdjustments', () => {
  it('retains the exact invoice total for invoice values and recalculates when quantity changes', () => {
    const rows = compareInvoice([order(line())], [
      invoice({ quantity: 2, price: 10.123, amount: 20.24 }),
      invoice({ article: 'EXTRA', sourceRow: 3 }),
    ]);
    const adjustment = buildInvoiceAdjustments(rows, 'invoice')[0]!;

    expect(adjustment).toMatchObject({ qty: 2, price: 10.123, amount: 20.24, included: true });
    expect(adjustmentAmount({ ...adjustment, qty: 1 }, rows[0]!)).toBe(10.123);
    expect(buildInvoiceAdjustments(rows, 'order')).toMatchObject([
      { qty: 3, price: 10.123, amount: 30.369, included: true },
      { qty: 3, included: false },
    ]);
  });
});

it('flags an unknown order price and includes the matched adjustment when the invoice price is known', () => {
  const rows = compareInvoice([order(line({ unitPrice: null, amount: null }))], [invoice()]);
  expect(rows[0]).toMatchObject({ differences: ['unpriced'], notes: [expect.stringContaining('заказе')] });
  expect(buildInvoiceAdjustments(rows, 'invoice')[0]).toMatchObject({ included: true, price: 10 });
});

it('rejects a comparison built from orders of different suppliers', () => {
  expect(() => compareInvoice([order(line()), { ...order(line()), supplier: 'Другой' }], [invoice()]))
    .toThrow(/одного поставщика/);
});

it.each([
  [{ quantity: -2 }, 'количество'],
  [{ price: -2, amount: -6 }, 'цену'],
])('keeps signed invoice data visible and omits it from default adjustment (%j)', (input, label) => {
  const rows = compareInvoice([order(line())], [invoice(input)]);
  expect(rows[0]?.notes.join(' ')).toContain(label);
  expect(buildInvoiceAdjustments(rows, 'invoice')[0]?.included).toBe(false);
});

it('keeps both original units for one-to-one conflicts and prevents a combined correction', () => {
  const rows = compareInvoice([order(line())], [invoice({ unit: 'упак' })]);

  expect(rows).toMatchObject([
    { orderQty: 3, invoiceQty: null, unit: 'шт', differences: ['unit'] },
    { orderQty: null, invoiceQty: 3, unit: 'упак', differences: ['unit'] },
  ]);
  expect(buildInvoiceAdjustments(rows, 'invoice').map(({ included }) => included)).toEqual([false, false]);
});

it('does not match two articles solely because they share an interior mixed token', () => {
  const rows = compareInvoice([order(line({ article: 'ABC123-LEFT' }))], [
    invoice({ article: 'ABC123-RIGHT' }),
  ]);
  expect(rows.map(({ differences }) => differences)).toEqual([['missing'], ['extra']]);
});

it('retains one-sided prefixed numeric article matching', () => {
  const rows = compareInvoice([order(line({ article: '123456' }))], [
    invoice({ article: 'Поставщик 123456' }),
  ]);
  expect(rows.map(({ differences }) => differences)).toEqual([[]]);
});
