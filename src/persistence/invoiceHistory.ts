import { ordersDocument, type InvoiceHistoryOverview } from '../appbox/ordersDocument';
import { lastInvoiceHistoryDocuments, type InvoiceHistoryRecord } from '../domain/invoiceHistory';
import { previewInvoiceHistory, type InvoiceHistoryImport } from '../domain/invoiceHistoryBackup';
import { db } from './db';

export async function loadInvoiceHistory(): Promise<InvoiceHistoryRecord[]> {
  const shared = ordersDocument();
  if (shared) return shared.loadInvoiceHistory();
  const database = await db();
  try {
    return await database.getAll('invoiceHistory');
  } finally {
    database.close();
  }
}

export async function loadInvoiceHistoryOverview(signal?: AbortSignal): Promise<InvoiceHistoryOverview> {
  const shared = ordersDocument();
  return shared ? shared.loadInvoiceHistoryOverview(signal) : { records: await loadInvoiceHistory() };
}

export async function openInvoiceHistorySession(documentId: string) {
  const shared = ordersDocument();
  if (!shared) throw new Error('Открытие сессии доступно внутри AppBox.');
  return shared.openInvoiceHistorySession(documentId);
}

function validateAppend(records: InvoiceHistoryRecord[], record: InvoiceHistoryRecord, expectedRevisions: number) {
  const current = records.find(({ id }) => id === record.id);
  const overlap = records.some((other) => other.id !== record.id && other.sourceId === record.sourceId &&
    other.orderIds.some((id) => record.orderIds.includes(id)));
  if (overlap || (current?.revisions.length ?? 0) !== expectedRevisions) {
    throw new Error(overlap ? 'Часть заказов входит в другой комплект сверки. Откройте его из истории.'
      : 'История уже изменилась. Обновите её и повторите действие.');
  }
  const previousParty = lastInvoiceHistoryDocuments(current)?.supplier;
  const nextParty = lastInvoiceHistoryDocuments(record)?.supplier;
  if (previousParty && previousParty.inn !== nextParty?.inn) {
    throw new Error('ИНН сохранённой сверки изменить нельзя.');
  }
}

export async function appendInvoiceHistory(
  record: InvoiceHistoryRecord, expectedRevisions: number,
): Promise<InvoiceHistoryRecord[]> {
  const shared = ordersDocument();
  if (shared) return shared.changeInvoiceHistory((records) => {
    validateAppend(records, record, expectedRevisions);
    const next = [...records.filter(({ id }) => id !== record.id), record];
    return { records: next, result: next };
  });
  const database = await db();
  try {
    const tx = database.transaction('invoiceHistory', 'readwrite');
    const records = await tx.store.getAll();
    try { validateAppend(records, record, expectedRevisions); }
    catch (error) { await tx.done; throw error; }
    await tx.store.put(record, record.id);
    await tx.done;
    return [...records.filter(({ id }) => id !== record.id), record];
  } finally {
    database.close();
  }
}

export async function restoreInvoiceHistory(incoming: InvoiceHistoryRecord[]): Promise<InvoiceHistoryImport> {
  const shared = ordersDocument();
  if (shared) return shared.changeInvoiceHistory((existing) => {
    const result = previewInvoiceHistory(existing, incoming);
    return { records: result.added.length ? [...existing, ...result.added] : existing, result };
  });
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
