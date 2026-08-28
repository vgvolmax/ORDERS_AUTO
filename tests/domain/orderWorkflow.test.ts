import { describe, expect, it } from 'vitest';
import {
  applyOrderQtyChange,
  getManualEditCount,
  setOrderReviewed,
  setOrdersReviewed,
} from '../../src/domain/orderWorkflow';
import type { Order } from '../../src/domain/types';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'Ленина\0Поставщик',
    branch: 'Ленина',
    supplier: 'Поставщик',
    totalQty: 10,
    totalAmount: 1000,
    belowThreshold: false,
    status: 'READY',
    blockers: [],
    lines: [
      {
        skuCode: 'SKU1',
        article: 'A-1',
        name: 'Товар',
        branch: 'Ленина',
        supplier: 'Поставщик',
        calculatedQty: 10,
        orderQty: 10,
        unit: 'шт',
        unitPrice: 100,
        priceSource: 'SUPPLIER_HISTORY',
        amount: 1000,
        warnings: [],
        stock: 0,
        min: 2,
        max: 10,
      },
    ],
    ...overrides,
  };
}

describe('order review lifecycle', () => {
  it('stores an effective edit and invalidates checked/exported state', () => {
    const result = applyOrderQtyChange({
      edits: [],
      reviewedOrderIds: ['Ленина\0Поставщик', 'Другой'],
      exportedOrderIds: ['Ленина\0Поставщик', 'Другой'],
      order: order(),
      skuCode: 'SKU1',
      qty: 12,
    });

    expect(result.edits).toEqual([
      { skuCode: 'SKU1', branch: 'Ленина', qty: 12 },
    ]);
    expect(result.reviewedOrderIds).toEqual(['Другой']);
    expect(result.exportedOrderIds).toEqual(['Другой']);
  });

  it('removes the edit when quantity returns to the calculated value', () => {
    const result = applyOrderQtyChange({
      edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 12 }],
      reviewedOrderIds: ['Ленина\0Поставщик'],
      exportedOrderIds: ['Ленина\0Поставщик'],
      order: order({
        lines: [
          {
            ...order().lines[0]!,
            orderQty: 12,
            amount: 1200,
          },
        ],
      }),
      skuCode: 'SKU1',
      qty: 10,
    });

    expect(result.edits).toEqual([]);
    expect(result.reviewedOrderIds).toEqual([]);
    expect(result.exportedOrderIds).toEqual([]);
  });

  it('counts only current effective line differences as manual edits', () => {
    const changed = order({
      lines: [
        { ...order().lines[0]!, orderQty: 12 },
        {
          ...order().lines[0]!,
          skuCode: 'SKU2',
          calculatedQty: 4,
          orderQty: 4,
        },
      ],
    });

    expect(getManualEditCount(changed)).toBe(1);
  });

  it('sets one or many review markers without duplicates', () => {
    expect(setOrderReviewed(['A'], 'A', true)).toEqual(['A']);
    expect(setOrderReviewed(['A'], 'A', false)).toEqual([]);
    expect(setOrdersReviewed(['A'], ['A', 'B', 'C'], true)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(setOrdersReviewed(['A', 'B', 'C'], ['A', 'C'], false)).toEqual([
      'B',
    ]);
  });
});
