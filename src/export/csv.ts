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

function escapeCell(value: unknown): string {
  const text = String(value ?? '');
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

  return (
    '\ufeff' +
    [HEADERS, ...rows]
      .map((row) => row.map(escapeCell).join(';'))
      .join('\r\n') +
    '\r\n'
  );
}
