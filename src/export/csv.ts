import type { Order } from '../domain/types';

const HEADERS = [
  'Код',
  'Артикул',
  'Номенклатура',
  'Подразделение',
  'Поставщик',
  'Количество',
  'Ед.',
  'Цена',
  'Сумма',
];

export function protectSpreadsheetText(text: string): string {
  // Quoting protects CSV delimiters but does not stop spreadsheet formulas.
  return /^\s*[=+\-@]/u.test(text) ? "'" + text : text;
}

function escapeCell(text: string): string {
  if (!/[;"\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function orderToCsv(order: Order): string {
  const rows = order.lines
    .filter((line) => line.orderQty > 0)
    .map((line) => [
      line.skuCode,
      line.article,
      line.name,
      order.branch,
      order.supplier,
      line.orderQty,
      line.unit,
      line.unitPrice,
      line.amount,
    ]);

  return rowsToCsv(HEADERS, rows, { protectFormulas: true });
}

export function rowsToCsv(
  headers: string[],
  rows: unknown[][],
  { protectFormulas = false } = {},
): string {
  return (
    '\ufeff' +
    [headers, ...rows]
      .map((row) => row.map((value) => {
        const text = protectFormulas && typeof value === 'string'
          ? protectSpreadsheetText(value)
          : String(value ?? '');
        return escapeCell(text);
      }).join(';'))
      .join('\r\n') +
    '\r\n'
  );
}
