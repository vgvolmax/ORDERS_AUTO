import { INVOICE_PRICE_TOLERANCE, type InvoiceComparisonRow } from './invoices';
import { moneySum } from './money';

export function invoiceAmountDifference(row: InvoiceComparisonRow): number | null {
  return row.orderAmount === null || row.invoiceAmount === null
    ? null : moneySum([row.invoiceAmount, -row.orderAmount]);
}

export function hasInvoiceAmountDifference(row: InvoiceComparisonRow): boolean {
  const difference = invoiceAmountDifference(row);
  return difference !== null && difference !== 0;
}

export function hasInvoiceDiscrepancy(row: InvoiceComparisonRow): boolean {
  return row.differences.length > 0 || hasInvoiceAmountDifference(row);
}

export function invoicePriceWithinTolerance(row: InvoiceComparisonRow): boolean {
  if (row.orderPrice === null || row.invoicePrice === null) return false;
  const difference = Math.abs(moneySum([row.invoicePrice, -row.orderPrice]));
  return difference > 0 && difference <= INVOICE_PRICE_TOLERANCE;
}

/** Whole-document totals, independent of UI filters and correction drafts. */
export function summarizeInvoiceAmounts(rows: readonly InvoiceComparisonRow[]) {
  const sumKnown = (values: (number | null)[]) =>
    values.some((value) => value === null) ? null : moneySum(values as number[]);
  const orderAmount = sumKnown(rows.filter((row) => row.orderQty !== null).map((row) => row.orderAmount));
  const invoiceAmount = sumKnown(rows.filter((row) => row.invoiceQty !== null).map((row) => row.invoiceAmount));
  return {
    orderAmount, invoiceAmount,
    difference: orderAmount === null || invoiceAmount === null ? null : moneySum([invoiceAmount, -orderAmount]),
  };
}
