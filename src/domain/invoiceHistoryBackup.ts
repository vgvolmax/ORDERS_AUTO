import {
  historyOrderKey, invoiceHistoryStatuses, type InvoiceHistoryRecord,
} from './invoiceHistory';

export interface InvoiceHistoryImport {
  added: InvoiceHistoryRecord[];
  duplicates: number;
  conflicts: string[];
}

const format = 'ORDERS_AUTO.invoice-history';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const date = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function validPosition(value: unknown): boolean {
  if (!object(value) || !nonEmpty(value.key) || !nonEmpty(value.skuCode)
    || typeof value.article !== 'string' || typeof value.name !== 'string'
    || (value.unit !== null && typeof value.unit !== 'string')
    || typeof value.requested !== 'number' || !Number.isFinite(value.requested) || value.requested <= 0
    || typeof value.invoiced !== 'number' || !Number.isFinite(value.invoiced)
    || value.invoiced < 0 || value.invoiced > value.requested
    || !invoiceHistoryStatuses.some((status) => status === value.stockStatus)) return false;
  if (value.outcome === 'covered') {
    return value.invoiced === value.requested && value.reason === null && value.refusalAt === null;
  }
  if (value.outcome === 'removed') {
    return value.invoiced === 0 && value.reason === 'buyer' && value.refusalAt === null;
  }
  return (value.reason === 'closed' || value.reason === 'confirmed') && date(value.refusalAt)
    && ((value.outcome === 'full' && value.invoiced === 0)
      || (value.outcome === 'partial' && value.invoiced > 0 && value.invoiced < value.requested));
}

function validRecord(value: unknown): value is InvoiceHistoryRecord {
  if (!object(value) || !nonEmpty(value.sourceId) || !Array.isArray(value.orderIds)
    || value.orderIds.length === 0 || !value.orderIds.every(nonEmpty)
    || new Set(value.orderIds).size !== value.orderIds.length
    || value.id !== historyOrderKey(value.sourceId, value.orderIds)
    || (value.orderSupplier !== undefined && !nonEmpty(value.orderSupplier))
    || (value.basis !== 'current' && value.basis !== 'preferred')
    || !Array.isArray(value.revisions) || !value.revisions.length) return false;
  const orderIds = new Set(value.orderIds);
  let closed = false;
  return value.revisions.every((revision) => {
    if (!object(revision) || !date(revision.at)) return false;
    if (revision.kind === 'reopened') {
      if (!closed) return false;
      closed = false;
      return true;
    }
    if (closed || (revision.kind !== 'closed' && revision.kind !== 'confirmed') || !object(revision.supplier)
      || !nonEmpty(revision.supplier.name) || !validSupplierInn(revision.supplier.inn)
      || !Array.isArray(revision.documents)
      || !revision.documents.every((file: unknown) => object(file) && nonEmpty(file.name)
        && Array.isArray(file.sheets) && file.sheets.every(nonEmpty)
        && nonEmpty(file.base64) && file.base64.length % 4 === 0
        && /^[A-Za-z0-9+/]+={0,2}$/.test(file.base64))) return false;
    if (revision.kind === 'confirmed') {
      return Array.isArray(revision.positions) && revision.positions.length > 0
        && revision.positions.every((position: unknown) => object(position) && nonEmpty(position.key)
          && invoiceHistoryStatuses.some((status) => status === position.stockStatus));
    }
    if (!Array.isArray(revision.orders) || revision.orders.length !== orderIds.size) return false;
    closed = true;
    const seen = new Set<unknown>();
    return revision.orders.every((order: unknown) => {
      if (!object(order) || !nonEmpty(order.id) || !orderIds.has(order.id) || seen.has(order.id) || !nonEmpty(order.branch)
        || (order.exportedAt !== null && !date(order.exportedAt))
        || !Array.isArray(order.positions) || !order.positions.length
        || !order.positions.every(validPosition)
        || new Set(order.positions.map((position) => position.key)).size !== order.positions.length) return false;
      seen.add(order.id);
      return true;
    });
  });
}

export function validSupplierInn(value: unknown): value is string {
  return typeof value === 'string' && /^(?:\d{10}|\d{12})$/.test(value);
}

export function encodeInvoiceHistory(records: readonly InvoiceHistoryRecord[], at: string): string {
  return JSON.stringify({ format, version: 1, exportedAt: at, records });
}

export function decodeInvoiceHistory(content: string): InvoiceHistoryRecord[] {
  const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
  if (!object(value) || value.format !== format || value.version !== 1
    || !date(value.exportedAt) || !Array.isArray(value.records) || !value.records.every(validRecord)
    || new Set(value.records.map(({ id }) => id)).size !== value.records.length) {
    throw new Error('Файл не соответствует формату резервной копии истории счетов.');
  }
  return value.records;
}

export function previewInvoiceHistory(
  existing: readonly InvoiceHistoryRecord[], incoming: readonly InvoiceHistoryRecord[],
): InvoiceHistoryImport {
  const byId = new Map(existing.map((record) => [record.id, record]));
  const orderKey = (sourceId: string, id: string) => JSON.stringify([sourceId, id]);
  const usedOrders = new Set(existing.flatMap(({ sourceId, orderIds }) => orderIds.map((id) => orderKey(sourceId, id))));
  const result: InvoiceHistoryImport = { added: [], duplicates: 0, conflicts: [] };
  for (const record of incoming) {
    const old = byId.get(record.id);
    if (old && JSON.stringify(old) === JSON.stringify(record)) {
      result.duplicates++;
    } else if (old || record.orderIds.some((id) => usedOrders.has(orderKey(record.sourceId, id)))) {
      result.conflicts.push(record.revisions.find((item) => item.kind !== 'reopened')?.supplier.name ?? record.id);
    } else {
      result.added.push(record);
      for (const id of record.orderIds) usedOrders.add(orderKey(record.sourceId, id));
    }
  }
  return result;
}
