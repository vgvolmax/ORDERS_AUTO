import { describe, expect, it } from 'vitest';
import {
  buildHistoryOrders, historyOrderKey, invoiceHistoryConfirmations, prepareHistoryPositions, type InvoiceHistoryRecord,
} from '../../src/domain/invoiceHistory';
import { decodeInvoiceHistory, encodeInvoiceHistory, previewInvoiceHistory } from '../../src/domain/invoiceHistoryBackup';
import { parseInvoiceHistoryDate, summarizeInvoiceHistory } from '../../src/domain/invoiceHistoryReport';
import { compareInvoice, type InvoiceItem } from '../../src/domain/invoices';
import type { Order, OrderLine } from '../../src/domain/types';

function order(id: string, skuCode = 'code'): Order {
  const line: OrderLine = {
    skuCode, article: skuCode, name: 'Товар', branch: id, supplier: 'Поставщик', calculatedQty: 10,
    orderQty: 10, unit: 'шт', unitPrice: 1, priceSource: 'MIN_MAX', amount: 10,
    warnings: [], stock: 0, min: 2, max: 10,
  };
  return { id, branch: id, supplier: line.supplier, lines: [line], totalQty: 10,
    totalAmount: 10, belowThreshold: false, status: 'READY', blockers: [] };
}

const at = '2026-11-25T10:00:00.000Z';
const status = (branch: string) => branch === 'north' ? 'BELOW_MIN' as const : 'YELLOW' as const;
const invoice: InvoiceItem = {
  skuCode: 'code', article: 'code', name: 'Товар', quantity: 6, unit: 'шт',
  price: 1, amount: 6, sourceRow: 2,
};
const noDecisions = new Map();

describe('invoice history', () => {
  it('requires allocating shared partial quantities before attributing refusals to orders', () => {
    const orders = [order('north'), order('south')];
    const groups = prepareHistoryPositions(orders, compareInvoice(orders, [invoice]), status);
    expect(() => buildHistoryOrders(orders, groups, noDecisions, at)).toThrow(/количество/i);
    const [group] = groups;
    const first = group!.lines[0]!;
    const second = group!.lines[1]!;
    const results = buildHistoryOrders(orders, groups, new Map([
      [first.key, { qty: '6', reason: 'confirmed' }],
      [second.key, { qty: '0', reason: 'closed' }],
    ]), at);
    expect(results.map(({ positions }) => positions[0])).toMatchObject([
      { outcome: 'partial', invoiced: 6, reason: 'confirmed', stockStatus: 'BELOW_MIN' },
      { outcome: 'full', invoiced: 0, reason: 'closed', stockStatus: 'YELLOW' },
    ]);
    expect(() => buildHistoryOrders(orders, groups, new Map([
      [first.key, { qty: '6', reason: 'closed' }],
      [second.key, { qty: '6', reason: 'closed' }],
    ]), at)).toThrow(/распредел/i);
  });

  it('preserves the refusal status on reclose and excludes buyer removals from the denominator', () => {
    const orders = [order('north'), order('south')];
    const groups = prepareHistoryPositions(orders, compareInvoice(orders, []), status);
    const saved = buildHistoryOrders(orders, groups, new Map([
      [groups[0]!.lines[0]!.key, { qty: '', reason: 'confirmed' }],
      [groups[0]!.lines[1]!.key, { qty: '', reason: 'buyer' }],
    ]), at);
    const changed = prepareHistoryPositions(orders, compareInvoice(orders, []), () => 'OK');
    const result = buildHistoryOrders(orders, changed, noDecisions, '2026-11-26T10:00:00.000Z', saved);
    expect(result).toEqual(saved);
    const record: InvoiceHistoryRecord = {
      id: historyOrderKey('week', ['north', 'south']), sourceId: 'week', basis: 'preferred',
      orderIds: ['north', 'south'],
      revisions: [{ kind: 'closed', at, supplier: { inn: '1234567890', name: 'ООО Поставщик' }, documents: [], orders: result }],
    };
    expect(summarizeInvoiceHistory([record], 'supplier', { status: 'BELOW_MIN' })[0]).toMatchObject({
      orders: 1, affectedOrders: 1, full: 1, partial: 0, belowMin: 1, share: 1,
    });
  });

  it('keeps the first explicitly confirmed shortage status while awaiting more invoices', () => {
    const orders = [order('north')];
    const groups = prepareHistoryPositions(orders, compareInvoice(orders, []), () => 'OK');
    const key = groups[0]!.lines[0]!.key;
    const record: InvoiceHistoryRecord = {
      id: historyOrderKey('week', ['north']), sourceId: 'week', basis: 'preferred', orderIds: ['north'],
      revisions: [{ kind: 'confirmed', at, supplier: { inn: '1234567890', name: 'ООО Поставщик' },
        documents: [], positions: [{ key, stockStatus: 'BELOW_MIN' }] }],
    };
    expect(decodeInvoiceHistory(encodeInvoiceHistory([record], at))).toEqual([record]);
    expect(summarizeInvoiceHistory([record], 'supplier', {})).toEqual([]);
    const result = buildHistoryOrders(orders, groups, new Map([[key, { qty: '0', reason: 'confirmed' }]]),
      '2026-11-26T10:00:00.000Z', [], invoiceHistoryConfirmations(record));
    expect(result[0]!.positions[0]).toMatchObject({ stockStatus: 'BELOW_MIN', refusalAt: at });
  });

  it('counts one affected order with several short items and leaves the denominator intact under status filters', () => {
    const orders = [order('north'), order('south')];
    orders[0]!.lines.push(order('north', 'other').lines[0]!);
    const groups = prepareHistoryPositions(orders, compareInvoice(orders, []), status);
    const results = buildHistoryOrders(orders, groups, noDecisions, at);
    const record: InvoiceHistoryRecord = {
      id: historyOrderKey('week', ['north', 'south']), sourceId: 'week', basis: 'preferred',
      orderIds: ['north', 'south'],
      revisions: [{ kind: 'closed', at, supplier: { inn: '1234567890', name: 'ООО Поставщик' }, documents: [], orders: results }],
    };
    expect(summarizeInvoiceHistory([record], 'supplier', {})[0]).toMatchObject({
      orders: 2, affectedOrders: 2, full: 3, affectedSkus: 2,
    });
    expect(summarizeInvoiceHistory([record], 'supplier', { status: 'BELOW_MIN' })[0]).toMatchObject({
      orders: 2, affectedOrders: 1, full: 2, share: 0.5,
    });
    const backup = decodeInvoiceHistory(encodeInvoiceHistory([record], at));
    expect(backup).toEqual([record]);
    expect(previewInvoiceHistory([record], backup)).toEqual({ added: [], duplicates: 1, conflicts: [] });
    record.revisions.push({ kind: 'reopened', at });
    expect(previewInvoiceHistory([record], backup)).toEqual({ added: [], duplicates: 0, conflicts: ['ООО Поставщик'] });
    expect(summarizeInvoiceHistory([record], 'supplier', {})).toEqual([]);
  });
});


describe('history date filter', () => {
  it('reads Russian date order and rejects nonexistent calendar days', () => {
    expect(parseInvoiceHistoryDate('07.12.2026')).toBe('2026-12-07');
    expect(parseInvoiceHistoryDate('29122026')).toBe('2026-12-29');
    expect(parseInvoiceHistoryDate('29.02.2024')).toBe('2024-02-29');
    expect(parseInvoiceHistoryDate('29.02.2026')).toBeNull();
    expect(parseInvoiceHistoryDate('2026-12-07')).toBeNull();
    expect(parseInvoiceHistoryDate('')).toBe('');
  });
});
