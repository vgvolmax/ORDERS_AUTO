import type {
  ClosedInvoiceHistory, InvoiceHistoryOrder, InvoiceHistoryPosition, InvoiceHistoryRecord, InvoiceHistoryStatus,
} from './invoiceHistory';
import { moneySum } from './money';

export type InvoiceHistoryView = 'supplier' | 'sku';

export interface InvoiceHistoryFilters {
  from?: string;
  to?: string;
  inn?: string;
  sku?: string;
  status?: InvoiceHistoryStatus | '';
}

export interface InvoiceHistoryDetail {
  record: InvoiceHistoryRecord;
  revision: ClosedInvoiceHistory;
  order: InvoiceHistoryOrder;
  position: InvoiceHistoryPosition;
}

export interface InvoiceHistorySummary {
  key: string;
  name: string;
  sublabel: string;
  orders: number;
  affectedOrders: number;
  affectedSkus: number;
  full: number;
  partial: number;
  share: number;
  belowMin: number;
  shortage: Record<string, number>;
  shortagePieces: number;
  stockCounts: Partial<Record<InvoiceHistoryStatus, number>>;
  latestRefusal: string;
  details: InvoiceHistoryDetail[];
}

/** Empty means no filter. Null means the calendar date is invalid. */
export function parseInvoiceHistoryDate(input: string): string | null {
  const text = input.trim();
  if (!text) return '';
  const parts = /^(\d{2})[.](\d{2})[.](\d{4})$/.exec(text) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  if (!parts) return null;
  const [, day, month, year] = parts;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function isInvoiceRefusal(position: InvoiceHistoryPosition): boolean {
  return position.outcome === 'full' || position.outcome === 'partial';
}

export function summarizeInvoiceHistory(
  records: readonly InvoiceHistoryRecord[], view: InvoiceHistoryView, filters: InvoiceHistoryFilters,
): InvoiceHistorySummary[] {
  const groups = new Map<string, InvoiceHistoryDetail[]>();
  for (const record of records) {
    const revision = record.revisions.at(-1);
    if (revision?.kind !== 'closed' || (filters.inn && revision.supplier.inn !== filters.inn)) continue;
    const day = new Date(revision.at).toLocaleDateString('sv-SE');
    if ((filters.from && day < filters.from) || (filters.to && day > filters.to)) continue;
    for (const order of revision.orders) {
      for (const position of order.positions) {
        if (position.outcome === 'removed' || (filters.sku && position.skuCode !== filters.sku)) continue;
        const key = view === 'supplier' ? revision.supplier.inn : position.skuCode;
        const detail = { record, revision, order, position };
        const group = groups.get(key);
        if (group) group.push(detail);
        else groups.set(key, [detail]);
      }
    }
  }
  return [...groups].flatMap(([key, details]) => {
    const orderIdentity = (row: InvoiceHistoryDetail) => JSON.stringify([row.record.sourceId, row.order.id]);
    const orders = new Set(details.map(orderIdentity)).size;
    const refusals = details.filter(({ position }) =>
      isInvoiceRefusal(position) && (!filters.status || position.stockStatus === filters.status));
    if (filters.status && refusals.length === 0) return [];
    const last = details.reduce((latest, detail) => detail.revision.at > latest.revision.at ? detail : latest);
    let full = 0;
    let latestRefusal = '';
    const stockCounts: InvoiceHistorySummary['stockCounts'] = {};
    const shortage = new Map<string, number>();
    for (const { position } of refusals) {
      if (position.outcome === 'full') full++;
      stockCounts[position.stockStatus] = (stockCounts[position.stockStatus] ?? 0) + 1;
      if (position.refusalAt && position.refusalAt > latestRefusal) latestRefusal = position.refusalAt;
      const unit = position.unit ?? 'без ед.';
      shortage.set(unit, moneySum([shortage.get(unit) ?? 0, position.requested, -position.invoiced]));
    }
    const affectedOrders = new Set(refusals.map(orderIdentity)).size;
    return [{
      key, name: view === 'supplier' ? last.revision.supplier.name : last.position.article || last.position.skuCode,
      sublabel: view === 'supplier' ? last.revision.supplier.inn : last.position.name,
      orders, affectedOrders, affectedSkus: new Set(refusals.map(({ position }) => position.skuCode)).size,
      full, partial: refusals.length - full, share: affectedOrders / orders,
      belowMin: stockCounts.BELOW_MIN ?? 0, shortage: Object.fromEntries(shortage),
      shortagePieces: moneySum([...shortage].filter(([unit]) => /^шт[.]?$/iu.test(unit.trim())).map(([, qty]) => qty)),
      stockCounts, latestRefusal,
      details: filters.status ? refusals : details,
    }];
  });
}
