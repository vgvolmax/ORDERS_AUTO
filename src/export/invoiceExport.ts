import * as XLSX from 'xlsx';
import { invoiceDifferenceLabels, type InvoiceAdjustment, type InvoiceComparisonRow } from '../domain/invoices';
import { moneySum } from '../domain/money';
import { normalizeKey } from '../domain/normalize';
import { protectSpreadsheetText, rowsToCsv } from './csv';
import { hasInvoiceAmountDifference, invoiceAmountDifference, invoicePriceWithinTolerance } from '../domain/invoiceAmounts';

const ADJUSTMENT_HEADERS = ['Артикул', 'Номенклатура', 'Количество', 'Ед.', 'Цена', 'Сумма'];
const COMPARISON_HEADERS = [
  'Расхождения', 'Код 1С', 'Артикул', 'Номенклатура', 'Количество заказа', 'Количество счёта',
  'Разница количества', 'Ед.', 'Цена заказа', 'Цена счёта', 'Разница цены', 'Сумма заказа', 'Сумма счёта', 'Разница суммы', 'Комментарий',
];
type Cell = string | number | null;

function textCell(value: Cell): string {
  if (typeof value === 'number') return String(value).replace('.', ',');
  return protectSpreadsheetText((value ?? '').replace(/[\t\r\n]/g, ' '));
}

function delta(before: number | null, after: number | null): number | null {
  return before === null || after === null ? null : moneySum([after, -before]);
}

export function invoiceComparisonCsv(rows: readonly InvoiceComparisonRow[]): string {
  return rowsToCsv(COMPARISON_HEADERS, rows.map((row) => [
    [...row.differences.map((difference) => invoiceDifferenceLabels[difference]), ...(hasInvoiceAmountDifference(row) ? ['Разница суммы'] : [])].join(', ') || 'Совпадает',
    row.skuCode, row.article, row.name, row.orderQty, row.invoiceQty, delta(row.orderQty, row.invoiceQty),
    row.unit, row.orderPrice, row.invoicePrice, delta(row.orderPrice, row.invoicePrice),
    row.orderAmount, row.invoiceAmount, invoiceAmountDifference(row),
    [...row.notes, ...(invoicePriceWithinTolerance(row) ? ['Цена в пределах допуска 0,01 ₽ за единицу.'] : [])].join(' '),
  ].map(textCell)));
}

export function conflictingInvoiceAdjustments(rows: readonly InvoiceAdjustment[]): InvoiceAdjustment[] {
  const byIdentity = new Map<string, InvoiceAdjustment[]>();
  for (const row of rows) {
    if (!row.included) continue;
    const key = JSON.stringify([
      normalizeKey(row.article),
      normalizeKey(row.name),
      normalizeKey(row.unit).replace(/[.\s]/g, ''),
    ]);
    const group = byIdentity.get(key);
    if (group) group.push(row);
    else byIdentity.set(key, [row]);
  }
  return [...byIdentity.values()].filter((group) => group.length > 1).flat();
}

function adjustmentCells(rows: readonly InvoiceAdjustment[]): Cell[][] {
  if (conflictingInvoiceAdjustments(rows).length > 0) {
    throw new Error('Отмеченные позиции неразличимы для 1С. Оставьте одну строку на артикул, наименование и единицу.');
  }
  return rows.filter((row) => row.included).map((row) => [
    row.article, row.name, row.qty, row.unit, row.price, row.amount,
  ]);
}

export function invoiceAdjustmentCsv(rows: readonly InvoiceAdjustment[]): string {
  return rowsToCsv(ADJUSTMENT_HEADERS, adjustmentCells(rows).map((row) => row.map(textCell)));
}

export function invoiceAdjustmentTsv(rows: readonly InvoiceAdjustment[]): string {
  return [ADJUSTMENT_HEADERS, ...adjustmentCells(rows)]
    .map((row) => row.map(textCell).join('\t'))
    .join('\n');
}

export function invoiceAdjustmentWorkbook(rows: readonly InvoiceAdjustment[]): ArrayBuffer {
  const cells = adjustmentCells(rows);
  if (cells.length >= 65_536) throw new Error('В файл .xls можно выгрузить не более 65 535 товарных строк.');
  const sheet = XLSX.utils.aoa_to_sheet([ADJUSTMENT_HEADERS, ...cells]);
  sheet['!cols'] = [{ wch: 20 }, { wch: 55 }, { wch: 15 }, { wch: 8 }, { wch: 15 }, { wch: 15 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Заказ_1С');
  return XLSX.write(workbook, { type: 'array', bookType: 'biff8' });
}
