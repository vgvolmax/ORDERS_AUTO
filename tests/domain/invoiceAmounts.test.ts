import { expect, it } from 'vitest';
import { hasInvoiceAmountDifference, invoiceAmountDifference, summarizeInvoiceAmounts } from '../../src/domain/invoiceAmounts';
import type { InvoiceComparisonRow } from '../../src/domain/invoices';

const row = (values: Partial<InvoiceComparisonRow>): InvoiceComparisonRow => ({
  id: 'a', skuCode: '001', article: 'A', name: 'Товар', unit: 'шт', orderQty: 1, invoiceQty: 1,
  orderPrice: 100, invoicePrice: 100, orderAmount: 100, invoiceAmount: 100, differences: [], notes: [], ...values,
});

it.each([
  [120, 20], [90, -10], [null, null],
] as const)('summarizes a known order against invoice amount %s without hiding the sign or unknown data', (invoiceAmount, difference) => {
  expect(summarizeInvoiceAmounts([row({ invoiceAmount })])).toEqual({ orderAmount: 100, invoiceAmount, difference });
});

it('does not replace an unknown order amount with zero', () => {
  expect(summarizeInvoiceAmounts([row({ orderAmount: null })])).toEqual({ orderAmount: null, invoiceAmount: 100, difference: null });
});

it('counts missing and extra positions in whole-document totals without inventing per-row matches', () => {
  const missing = row({ invoiceQty: null, invoicePrice: null, invoiceAmount: null, differences: ['missing'] });
  const extra = row({ id: 'b', orderQty: null, orderPrice: null, orderAmount: null, invoiceAmount: 60, differences: ['extra'] });
  expect(summarizeInvoiceAmounts([missing, extra])).toEqual({ orderAmount: 100, invoiceAmount: 60, difference: -40 });
  expect(invoiceAmountDifference(missing)).toBeNull();
  expect(invoiceAmountDifference(extra)).toBeNull();
});

it('preserves per-row discrepancies even when increases and decreases cancel in the document total', () => {
  const rows = [row({ invoiceAmount: 110 }), row({ id: 'b', invoiceAmount: 90 })];
  expect(summarizeInvoiceAmounts(rows)).toEqual({ orderAmount: 200, invoiceAmount: 200, difference: 0 });
  expect(rows.map(hasInvoiceAmountDifference)).toEqual([true, true]);
});
