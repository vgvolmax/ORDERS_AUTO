import ExcelJS from 'exceljs';
import companyLogo from '../../src/styles/brand/volmax-company.png?inline';
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
  it('brands a reviewed supplier export and preserves its exact aggregated quantities and costs', async () => {
    const reviewedSubset = orders.slice(0, 2);
    const buffer = await buildSupplierWorkbook('Поставщик', reviewedSubset, 'REVIEWED');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Общий заказ',
      'Ленина',
      'Ступино',
    ]);
    expect(workbook.getWorksheet('Щурово')).toBeUndefined();
    expect(workbook.creator).toContain('Волмакс');

    const dashboard = workbook.getWorksheet('Общий заказ')!;
    expect(dashboard.getCell('A2').value).toBe('УК Волмакс');
    expect(workbook.model.media[0]?.buffer).toEqual(Buffer.from(companyLogo.split(',')[1]!, 'base64'));
    expect(dashboard.getCell('E1').value).toBe('ЗАКАЗ ПОСТАВЩИКУ');
    expect(String(dashboard.getCell('E2').value)).toContain('ПРОВЕРЕННЫЕ ЗАКАЗЫ');
    expect(dashboard.getCell('A3').value).toBe('ПОСТАВЩИК');
    expect(dashboard.getCell('B3').value).toBe('Поставщик');
    expect(dashboard.getCell('A6').value).toBe(300);
    expect(dashboard.getCell('C6').value).toBe(1);
    expect(dashboard.getCell('E6').value).toBe(2);
    expect(dashboard.getCell('A8').value).toBe('Код');
    expect(dashboard.getCell('G8').value).toBe('Сумма, ₽');

    expect(dashboard.getCell('A9').value).toBe('SKU1');
    expect(dashboard.getCell('D9').value).toBe(3);
    expect(dashboard.getCell('G9').value).toBe(300);
    expect(dashboard.getCell('A10').value).toBe('ИТОГО');
    expect(dashboard.getCell('D10').value).toBe(3);
    expect(dashboard.getCell('G10').value).toBe(300);
    expect(dashboard.getCell('G9').numFmt).toContain('₽');

    expect(dashboard.getImages()).toHaveLength(1);
    expect(dashboard.views[0]).toMatchObject({ state: 'frozen', ySplit: 8, showGridLines: false });
    expect(dashboard.autoFilter).toBe('A8:G9');
    expect(dashboard.pageSetup.orientation).toBe('landscape');
    expect(dashboard.pageSetup.printTitlesRow).toBe('8:8');
    expect(dashboard.pageSetup.printArea).toBe('A1:G12');

    const branch = workbook.getWorksheet('Ленина')!;
    expect(branch.getCell('E1').value).toBe('ЗАКАЗ ПОДРАЗДЕЛЕНИЯ');
    expect(branch.getCell('B3').value).toBe('Поставщик  ·  Ленина');
    expect(branch.getCell('A9').value).toBe('SKU1');
    expect(branch.getCell('D9').value).toBe(2);
    expect(branch.getCell('G9').value).toBe(200);
    expect(branch.getCell('D10').value).toBe(2);
    expect(branch.getCell('G10').value).toBe(200);
    expect(branch.getImages()).toHaveLength(1);
  });

  it('labels the full export honestly and retains all selected branches', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildSupplierWorkbook('Поставщик', orders, 'ALL'));
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual([
      'Общий заказ', 'Ленина', 'Ступино', 'Щурово',
    ]);
    const summary = wb.getWorksheet('Общий заказ')!;
    expect(String(summary.getCell('E2').value)).toContain('ВСЕ ЗАКАЗЫ');
    expect(summary.getCell('A6').value).toBe(800);
    expect(summary.getCell('C6').value).toBe(1);
    expect(summary.getCell('E6').value).toBe(3);
    expect(summary.getCell('D9').value).toBe(8);
    expect(summary.getCell('G9').value).toBe(800);
    expect(summary.getCell('D10').value).toBe(8);
    expect(summary.getCell('G10').value).toBe(800);
    expect(wb.getWorksheet('Щурово')!.getCell('G9').value).toBe(500);
  });

  it('retains text SKU identifiers, zeroes and empty costs rather than introducing new calculations', async () => {
    const copy: Order = structuredClone(orders[0]!);
    copy.lines[0]!.skuCode = '000123';
    copy.lines[0]!.article = '000045';
    copy.lines[0]!.amount = null;
    copy.lines[0]!.unitPrice = null;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildSupplierWorkbook('Поставщик', [copy]));
    const summary = wb.getWorksheet('Общий заказ')!;
    expect(summary.getCell('A9').value).toBe('000123');
    expect(summary.getCell('B9').value).toBe('000045');
    expect(summary.getCell('A9').numFmt).toBe('@');
    expect(summary.getCell('G9').value).toBe(0);
    expect(wb.getWorksheet('Ленина')!.getCell('F9').value).toBeNull();
    expect(wb.getWorksheet('Ленина')!.getCell('G9').value).toBeNull();
  });
});

it('keeps each branch sheet when names collide or Excel reserves a name', async () => {
  const branches = ['Склад/', 'склад*', 'ОБЩИЙ ЗАКАЗ', 'History', "Склад'", "'   '"];
  const supplierOrders = branches.map((branch, i) => ({
    ...orders[0]!,
    id: branch,
    branch,
    lines: [{ ...orders[0]!.lines[0]!, skuCode: 'SKU-' + (i + 1), branch }],
  }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildSupplierWorkbook('Поставщик', supplierOrders));

  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    'Общий заказ', 'Склад', 'склад (2)', 'ОБЩИЙ ЗАКАЗ (2)', 'History (2)', 'Склад (3)', 'Лист',
  ]);
  expect(workbook.worksheets.slice(1).map((sheet) => sheet.getCell('A9').value)).toEqual([
    'SKU-1', 'SKU-2', 'SKU-3', 'SKU-4', 'SKU-5', 'SKU-6',
  ]);
});
