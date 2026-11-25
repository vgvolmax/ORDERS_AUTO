import type { InvoiceHistoryRecord } from '../domain/invoiceHistory';
import { previewInvoiceHistory, type InvoiceHistoryImport } from '../domain/invoiceHistoryBackup';
import { db } from './db';

export async function loadInvoiceHistory(): Promise<InvoiceHistoryRecord[]> {
  const database = await db();
  try {
    return await database.getAll('invoiceHistory');
  } finally {
    database.close();
  }
}

export async function appendInvoiceHistory(
  record: InvoiceHistoryRecord, expectedRevisions: number,
): Promise<InvoiceHistoryRecord[]> {
  const database = await db();
  try {
    const tx = database.transaction('invoiceHistory', 'readwrite');
    const records = await tx.store.getAll();
    const current = records.find(({ id }) => id === record.id);
    const overlap = records.some((other) => other.id !== record.id && other.sourceId === record.sourceId &&
      other.orderIds.some((id) => record.orderIds.includes(id)));
    if (overlap || (current?.revisions.length ?? 0) !== expectedRevisions) {
      await tx.done;
      throw new Error(overlap ? 'Часть заказов входит в другой комплект сверки. Откройте его из истории.'
        : 'История уже изменилась. Обновите её и повторите действие.');
    }
    await tx.store.put(record, record.id);
    await tx.done;
    return [...records.filter(({ id }) => id !== record.id), record];
  } finally {
    database.close();
  }
}

export async function restoreInvoiceHistory(incoming: InvoiceHistoryRecord[]): Promise<InvoiceHistoryImport> {
  const database = await db();
  try {
    const tx = database.transaction('invoiceHistory', 'readwrite');
    const existing = await tx.store.getAll();
    const result = previewInvoiceHistory(existing, incoming);
    await Promise.all([...result.added.map((record) => tx.store.add(record, record.id)), tx.done]);
    return result;
  } finally {
    database.close();
  }
}
