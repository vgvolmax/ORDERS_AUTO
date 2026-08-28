import { describe, expect, it } from 'vitest';
import {
  orderCsvFilename,
  ordersZipFilename,
  supplierWorkbookFilename,
} from '../../src/export/orderFilenames';
import type { Order } from '../../src/domain/types';

const order = {
  id: 'Ленина\0ООО Тест',
  branch: 'Ленина',
  supplier: 'ООО Тест',
} as Order;

const date = new Date(2026, 7, 28, 23, 59, 0);

describe('order export filenames', () => {
  it('includes the same local date in single and ZIP-member CSV names', () => {
    expect(orderCsvFilename(order, date)).toBe('Ленина__ООО Тест__2026-08-28.csv');
  });

  it('uses the local date for ZIP and supplier workbook names', () => {
    expect(ordersZipFilename(date)).toBe('Заказы_CSV__2026-08-28.zip');
    expect(supplierWorkbookFilename('ООО: Тест', date)).toBe(
      'ООО_ Тест__Заказ__2026-08-28.xlsx',
    );
  });
});
