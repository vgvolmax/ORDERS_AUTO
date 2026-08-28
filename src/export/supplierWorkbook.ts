import ExcelJS from 'exceljs';
import type { Order, OrderLine } from '../domain/types';
import { uniqueSheetName } from './filenames';

interface AggregatedLine {
  sample: OrderLine;
  qty: number;
  amount: number;
}

export async function buildSupplierWorkbook(
  supplier: string,
  orders: Order[],
): Promise<ArrayBuffer> {
  const supplierOrders = orders.filter((order) => order.supplier === supplier);
  const positiveLines = supplierOrders.flatMap((order) =>
    order.lines.filter((line) => line.orderQty > 0),
  );
  const usedSheetNames = new Set<string>();
  const workbook = new ExcelJS.Workbook();

  const dashboard = workbook.addWorksheet(
    uniqueSheetName('Общий заказ', usedSheetNames),
  );
  const skuCount = new Set(positiveLines.map((line) => line.skuCode)).size;
  const branchCount = new Set(supplierOrders.map((order) => order.branch)).size;
  const totalQty = positiveLines.reduce((sum, line) => sum + line.orderQty, 0);
  const totalAmount = positiveLines.reduce(
    (sum, line) => sum + (line.amount ?? 0),
    0,
  );

  dashboard.addRows([
    ['Поставщик', supplier],
    ['Общая сумма', totalAmount],
    ['Количество SKU', skuCount],
    ['Подразделений', branchCount],
    ['Общее количество', totalQty],
    [],
    ['Код', 'Артикул', 'Номенклатура', 'Всего количество', 'Ед.', 'Цена', 'Сумма'],
  ]);

  const aggregated = new Map<string, AggregatedLine>();
  for (const line of positiveLines) {
    const current = aggregated.get(line.skuCode);
    if (current) {
      current.qty += line.orderQty;
      current.amount += line.amount ?? 0;
    } else {
      aggregated.set(line.skuCode, {
        sample: line,
        qty: line.orderQty,
        amount: line.amount ?? 0,
      });
    }
  }

  for (const { sample, qty, amount } of aggregated.values()) {
    dashboard.addRow([
      sample.skuCode,
      sample.article,
      sample.name,
      qty,
      sample.unit,
      sample.unitPrice,
      amount,
    ]);
  }
  styleSheet(dashboard, 7);

  for (const order of supplierOrders) {
    const lines = order.lines.filter((line) => line.orderQty > 0);
    if (lines.length === 0) {
      continue;
    }

    const sheet = workbook.addWorksheet(
      uniqueSheetName(order.branch, usedSheetNames),
    );
    sheet.addRow([
      'Код',
      'Артикул',
      'Номенклатура',
      'Количество',
      'Ед.',
      'Цена',
      'Сумма',
    ]);
    for (const line of lines) {
      sheet.addRow([
        line.skuCode,
        line.article,
        line.name,
        line.orderQty,
        line.unit,
        line.unitPrice,
        line.amount,
      ]);
    }
    styleSheet(sheet, 1);
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

function styleSheet(sheet: ExcelJS.Worksheet, headerRow: number): void {
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.getRow(headerRow).font = { bold: true };
  sheet.getRow(headerRow).alignment = { vertical: 'middle' };
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: 7 },
  };
  sheet.columns = [14, 16, 40, 18, 10, 14, 16].map((width) => ({ width }));
  sheet.getColumn(4).numFmt = '#,##0.###';
  sheet.getColumn(6).numFmt = '#,##0.00';
  sheet.getColumn(7).numFmt = '#,##0.00';
}
