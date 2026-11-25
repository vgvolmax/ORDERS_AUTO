import { invoiceOrderRowId, type InvoiceComparisonRow } from './invoices';
import { moneySum } from './money';
import { parseOptionalNumber } from './normalize';
import type { Order, StockStatus } from './types';

export const invoiceHistoryStatuses = [
  'BELOW_MIN', 'LIGHT_RED', 'ORANGE', 'YELLOW', 'OK', 'NO_NORM', 'INVALID_NORM', 'unknown',
] as const satisfies readonly (StockStatus | 'unknown')[];

export type InvoiceHistoryStatus = typeof invoiceHistoryStatuses[number];
export type InvoiceHistoryReason = 'closed' | 'confirmed' | 'buyer';
type PositionOutcome = 'covered' | 'full' | 'partial' | 'removed';

export interface InvoiceHistoryPosition {
  key: string;
  skuCode: string;
  article: string;
  name: string;
  unit: string | null;
  requested: number;
  invoiced: number;
  outcome: PositionOutcome;
  reason: InvoiceHistoryReason | null;
  stockStatus: InvoiceHistoryStatus;
  refusalAt: string | null;
}

export interface InvoiceHistoryOrder {
  id: string;
  branch: string;
  exportedAt: string | null;
  positions: InvoiceHistoryPosition[];
}

export interface InvoiceHistoryDocument {
  name: string;
  sheets: string[];
  /** Original file bytes so the same set can be reopened offline. */
  base64: string;
}

export interface ClosedInvoiceHistory {
  kind: 'closed';
  at: string;
  supplier: { name: string; inn: string };
  documents: InvoiceHistoryDocument[];
  orders: InvoiceHistoryOrder[];
}

export interface InvoiceHistoryRecord {
  id: string;
  sourceId: string;
  basis: 'current' | 'preferred';
  orderIds: string[];
  revisions: Array<ClosedInvoiceHistory | { kind: 'reopened'; at: string }>;
}

export interface HistoryDecision {
  qty: string;
  reason: InvoiceHistoryReason;
}

interface PositionLine {
  key: string;
  orderId: string;
  branch: string;
  requested: number;
  stockStatus: InvoiceHistoryStatus;
}

export interface HistoryPositionGroup {
  key: string;
  skuCode: string;
  article: string;
  name: string;
  unit: string | null;
  available: number | null;
  lines: PositionLine[];
}

const epsilon = 0.0001;

export function historyOrderKey(sourceId: string, orderIds: readonly string[]): string {
  return JSON.stringify([sourceId, [...orderIds].sort()]);
}

export function lastClosedInvoiceHistory(record: InvoiceHistoryRecord | undefined): ClosedInvoiceHistory | undefined {
  return record?.revisions.filter((event): event is ClosedInvoiceHistory => event.kind === 'closed').at(-1);
}

export function prepareHistoryPositions(
  orders: readonly Order[],
  rows: readonly InvoiceComparisonRow[],
  getStatus: (branch: string, skuCode: string) => InvoiceHistoryStatus,
): HistoryPositionGroup[] {
  const groups = new Map<string, HistoryPositionGroup>();
  const comparisons = new Map(rows.filter((row) => row.orderQty !== null).map((row) => [row.id, row]));
  for (const order of orders) {
    const lines = new Map<string, PositionLine>();
    for (const line of order.lines) {
      if (line.orderQty <= 0) continue;
      const key = invoiceOrderRowId(line.skuCode, line.unit);
      let group = groups.get(key);
      if (!group) {
        const comparison = comparisons.get(key);
        const available = comparison && !comparison.differences.some((value) =>
          value === 'ambiguous' || value === 'unit' || value === 'signed' || value === 'unconfirmed')
          ? comparison.invoiceQty ?? 0 : null;
        group = {
          key, skuCode: line.skuCode, article: line.article ?? '', name: line.name,
          unit: line.unit, available, lines: [],
        };
        groups.set(key, group);
      }
      const previous = lines.get(key);
      if (previous) {
        previous.requested = moneySum([previous.requested, line.orderQty]);
        continue;
      }
      const position: PositionLine = {
        key: JSON.stringify([order.id, key]), orderId: order.id, branch: order.branch,
        requested: line.orderQty, stockStatus: getStatus(order.branch, line.skuCode),
      };
      group.lines.push(position);
      lines.set(key, position);
    }
  }
  return [...groups.values()];
}

export function historyGroupNeedsReview(group: HistoryPositionGroup): boolean {
  return group.available === null || moneySum(group.lines.map(({ requested }) => requested)) - group.available > epsilon;
}

export function historyDefaultQuantity(group: HistoryPositionGroup, requested: number): number | null {
  if (group.available === null) return null;
  if (!historyGroupNeedsReview(group)) return requested;
  if (group.lines.length === 1 || group.available === 0) return group.available;
  return null;
}

export function buildHistoryOrders(
  orders: readonly Order[],
  groups: readonly HistoryPositionGroup[],
  decisions: ReadonlyMap<string, HistoryDecision>,
  at: string,
  previousOrders: readonly InvoiceHistoryOrder[] = [],
): InvoiceHistoryOrder[] {
  const previous = new Map(previousOrders.flatMap(({ positions }) => positions).map((line) => [line.key, line]));
  const result = new Map(orders.map(({ id, branch, exportedAt }) => [id, {
    id, branch, exportedAt: exportedAt ?? null, positions: [] as InvoiceHistoryPosition[],
  }]));
  for (const group of groups) {
    const label = group.article || group.skuCode;
    const allocations: number[] = [];
    for (const line of group.lines) {
      const old = previous.get(line.key);
      const decision = decisions.get(line.key);
      const quantity = decision?.qty.trim()
        ? parseOptionalNumber(decision.qty)
        : historyDefaultQuantity(group, line.requested);
      if (quantity === null || quantity < 0 || quantity - line.requested > epsilon) {
        throw new Error(`Укажите выставленное количество для ${label} · ${line.branch} (от 0 до ${line.requested}).`);
      }
      const invoiced = Math.abs(line.requested - quantity) <= epsilon ? line.requested : quantity;
      const requestedReason = decision?.reason ?? old?.reason ?? 'closed';
      if (requestedReason === 'buyer' && invoiced > 0 && decision) {
        throw new Error(`Позицию ${label} можно снять с учёта, если количество в счёте равно нулю.`);
      }
      const outcome = invoiced === line.requested ? 'covered'
        : invoiced > 0 ? 'partial' : requestedReason === 'buyer' ? 'removed' : 'full';
      const refusal = outcome === 'full' || outcome === 'partial';
      const reason = outcome === 'covered' ? null : outcome === 'removed' ? 'buyer'
        : requestedReason === 'confirmed' ? 'confirmed' : 'closed';
      const retain = refusal && old?.refusalAt && old.reason === reason;
      result.get(line.orderId)!.positions.push({
        key: line.key, skuCode: group.skuCode, article: group.article, name: group.name, unit: group.unit,
        requested: line.requested, invoiced, outcome, reason,
        stockStatus: retain ? old.stockStatus : refusal ? line.stockStatus : 'unknown',
        refusalAt: retain ? old.refusalAt : refusal ? at : null,
      });
      allocations.push(invoiced);
    }
    const requested = moneySum(group.lines.map((line) => line.requested));
    const expected = group.available === null ? null : Math.min(requested, group.available);
    if (expected !== null && Math.abs(moneySum(allocations) - expected) > epsilon) {
      throw new Error(`Распределите по заказам всё выставленное количество для позиции ${label} (${expected}).`);
    }
  }
  return [...result.values()];
}
