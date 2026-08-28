import { describe, expect, it } from 'vitest';
import { buildOrderProjection } from '../../src/domain/orders';
import type { PricedDemandLine, SupplierResolution } from '../../src/domain/types';

function demand(overrides: Partial<PricedDemandLine> = {}): PricedDemandLine {
  return {
    skuCode: 'SKU1',
    article: 'A-1',
    name: 'Товар',
    branch: 'Ленина',
    stock: 0,
    min: 2,
    max: 10,
    status: 'BELOW_MIN',
    deficitQty: 10,
    deficitPct: 1,
    networkDeficitQty: 10,
    referencePrice: 100,
    selectedSupplier: 'Поставщик',
    supplierResolutionStatus: 'AUTO_SINGLE',
    unit: 'шт',
    unitPrice: 100,
    priceSource: 'SUPPLIER_HISTORY',
    demandAmount: 1000,
    networkDemandAmount: 1000,
    networkMissingPriceCount: 0,
    ...overrides,
  };
}

const resolved: SupplierResolution = {
  skuCode: 'SKU1',
  selectedSupplier: 'Поставщик',
  status: 'AUTO_SINGLE',
  candidates: [],
  recommendedSupplier: 'Поставщик',
};

describe('buildOrderProjection', () => {
  it('retains unresolved demand instead of losing it', () => {
    const unresolved: SupplierResolution = {
      ...resolved,
      selectedSupplier: null,
      status: 'UNRESOLVED',
    };
    const projection = buildOrderProjection(
      [demand({ selectedSupplier: null, supplierResolutionStatus: 'UNRESOLVED' })],
      [unresolved],
      [],
      { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' },
    );

    expect(projection.orders).toHaveLength(0);
    expect(projection.unassigned).toHaveLength(1);
  });

  it('applies edited quantity and warns above calculated quantity', () => {
    const projection = buildOrderProjection(
      [demand()],
      [resolved],
      [{ skuCode: 'SKU1', branch: 'Ленина', qty: 12 }],
      { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' },
    );

    expect(projection.orders[0]).toMatchObject({ totalQty: 12, totalAmount: 1200 });
    expect(projection.orders[0]?.lines[0]?.warnings).toContain(
      'Количество выше расчётного',
    );
  });

  it('blocks an order when every edited line is zero', () => {
    const projection = buildOrderProjection(
      [demand()],
      [resolved],
      [{ skuCode: 'SKU1', branch: 'Ленина', qty: 0 }],
      { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' },
    );

    expect(projection.orders[0]).toMatchObject({
      totalQty: 0,
      totalAmount: 0,
      status: 'BLOCKED',
    });
    expect(projection.orders[0]?.blockers).toContain('Нет позиций с количеством больше нуля');
  });

  it('supports supplier-total and branch-supplier threshold modes', () => {
    const lines = [
      demand({
        branch: 'Ленина',
        deficitQty: 6,
        unitPrice: 1000,
        demandAmount: 6000,
      }),
      demand({
        branch: 'Ступино',
        deficitQty: 6,
        unitPrice: 1000,
        demandAmount: 6000,
      }),
    ];

    const totalMode = buildOrderProjection(lines, [resolved], [], {
      minimumOrderAmount: 10_000,
      thresholdMode: 'SUPPLIER_TOTAL',
    });
    expect(totalMode.orders.every((order) => !order.belowThreshold)).toBe(true);

    const branchMode = buildOrderProjection(lines, [resolved], [], {
      minimumOrderAmount: 10_000,
      thresholdMode: 'BRANCH_SUPPLIER',
    });
    expect(branchMode.orders.every((order) => order.belowThreshold)).toBe(true);
  });

  it('hard-blocks an order when a positive line has no price', () => {
    const projection = buildOrderProjection(
      [demand({ unitPrice: null, demandAmount: null, priceSource: 'MISSING' })],
      [resolved],
      [],
      { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' },
    );

    expect(projection.orders[0]).toMatchObject({
      totalAmount: null,
      status: 'BLOCKED',
    });
    expect(projection.orders[0]?.blockers).toContain('Не хватает цены');
  });
});
