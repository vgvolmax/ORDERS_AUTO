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
