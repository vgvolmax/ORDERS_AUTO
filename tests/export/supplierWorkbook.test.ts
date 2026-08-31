import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildSupplierWorkbook } from '../../src/export/supplierWorkbook';
import type { Order } from '../../src/domain/types';

const orders: Order[] = [
  {
    id: 'Ленина\0Поставщик',
    branch: 'Ленина',
    supplier: 'Поставщик',
    totalQty: 2,
    totalAmount: 200,
    belowThreshold: false,
    status: 'READY',
    blockers: [],
    lines: [
      {
        skuCode: 'SKU1',
        article: 'A-1',
        name: 'Товар',
        branch: 'Ленина',
        supplier: 'Поставщик',
        calculatedQty: 3,
        orderQty: 2,
        unit: 'шт',
        unitPrice: 100,
        priceSource: 'SUPPLIER_HISTORY',
        amount: 200,
        warnings: [],
        stock: 1,
        min: 2,
        max: 4,
      },
    ],
  },
  {
    id: 'Ступино\0Поставщик',
    branch: 'Ступино',
    supplier: 'Поставщик',
    totalQty: 1,
    totalAmount: 100,
    belowThreshold: false,
    status: 'READY',
    blockers: [],
    lines: [
      {
        skuCode: 'SKU1',
        article: 'A-1',
        name: 'Товар',
        branch: 'Ступино',
        supplier: 'Поставщик',
        calculatedQty: 1,
        orderQty: 1,
        unit: 'шт',
        unitPrice: 100,
        priceSource: 'SUPPLIER_HISTORY',
        amount: 100,
        warnings: [],
        stock: 3,
        min: 2,
        max: 4,
      },
    ],
  },
  {
    id: 'Щурово\0Поставщик', branch: 'Щурово', supplier: 'Поставщик',
    totalQty: 5, totalAmount: 500, belowThreshold: false, status: 'READY', blockers: [],
    lines: [{
      skuCode: 'SKU1', article: 'A-1', name: 'Товар', branch: 'Щурово', supplier: 'Поставщик',
      calculatedQty: 5, orderQty: 5, unit: 'шт', unitPrice: 100,
      priceSource: 'SUPPLIER_HISTORY', amount: 500, warnings: [], stock: 0, min: 2, max: 5,
    }],
  },
];

describe('buildSupplierWorkbook', () => {
  it('creates dashboard KPIs, aggregated SKU row and branch sheets', async () => {
    const reviewedSubset = orders.slice(0, 2);
    const buffer = await buildSupplierWorkbook('Поставщик', reviewedSubset);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Общий заказ',
      'Ленина',
      'Ступино',
    ]);
    expect(workbook.getWorksheet('Щурово')).toBeUndefined();

    const dashboard = workbook.getWorksheet('Общий заказ')!;
    expect(dashboard.getCell('A1').value).toBe('Поставщик');
    expect(dashboard.getCell('B1').value).toBe('Поставщик');
    expect(dashboard.getCell('B2').value).toBe(300);
    expect(dashboard.getCell('B3').value).toBe(1);
    expect(dashboard.getCell('B4').value).toBe(2);
    expect(dashboard.getCell('B5').value).toBe(3);

    const skuRows = dashboard.getRows(8, 10) ?? [];
    const skuRow = skuRows.find((row) => row.getCell(1).value === 'SKU1');
    expect(skuRow?.getCell(4).value).toBe(3);
    expect(skuRow?.getCell(7).value).toBe(300);
  });
});
