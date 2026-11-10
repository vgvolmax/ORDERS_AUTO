import { expect, it } from 'vitest';
import { orderToCsv } from '../../src/export/csv';

it('exports edited qty and Excel-safe CSV', () => {
  const csv = orderToCsv({
    id: 'x',
    branch: 'Филиал',
    supplier: 'ООО;Тест',
    totalQty: 2,
    totalAmount: 20,
    belowThreshold: false,
    status: 'READY',
    blockers: [],
    lines: [
      {
        skuCode: '001',
        article: null,
        name: 'Товар "А"',
        branch: 'Филиал',
        supplier: 'ООО;Тест',
        calculatedQty: 4,
        orderQty: 2,
        unit: 'шт',
        unitPrice: 10,
        priceSource: 'SUPPLIER_HISTORY',
        amount: 20,
        warnings: [],
        stock: 0,
        min: 1,
        max: 4,
      },
    ],
  });

  expect(csv.startsWith('\ufeffКод;Артикул')).toBe(true);
  expect(csv).toContain(';2;');
  expect(csv).toContain('"ООО;Тест"');
  expect(csv.endsWith('\r\n')).toBe(true);
});

it('protects spreadsheet formula starters in order text while leaving numbers numeric', () => {
  const csv = orderToCsv({
    id: 'guard',
    branch: '  -10+2',
    supplier: '@SUM(A1)',
    totalQty: 0.25,
    totalAmount: -2.5,
    belowThreshold: false,
    status: 'READY',
    blockers: [],
    lines: [{
      skuCode: '0007',
      article: '=2+2',
      name: '+1+2',
      branch: '  -10+2',
      supplier: '@SUM(A1)',
      calculatedQty: 0.25,
      orderQty: 0.25,
      unit: 'шт',
      unitPrice: -10,
      priceSource: 'MIN_MAX',
      amount: -2.5,
      warnings: [],
      stock: 0,
      min: 0.25,
      max: 0.25,
    }],
  });

  expect(csv.split('\r\n')[1]).toBe("0007;'=2+2;'+1+2;'  -10+2;'@SUM(A1);0.25;шт;-10;-2.5");
});
