import type { Order } from '../domain/types';
import { formatLocalDate } from './date';
import { safeFilename } from './filenames';

export function orderCsvFilename(order: Order, date: Date = new Date()): string {
  return `${safeFilename(order.branch)}__${safeFilename(order.supplier)}__${formatLocalDate(date)}.csv`;
}

export function ordersZipFilename(date: Date = new Date()): string {
  return `Заказы_CSV__${formatLocalDate(date)}.zip`;
}

export function supplierWorkbookFilename(
  supplier: string,
  date: Date = new Date(),
): string {
  return `${safeFilename(supplier)}__Заказ__${formatLocalDate(date)}.xlsx`;
}
