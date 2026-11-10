import { describe, expect, it } from 'vitest';
import { calculateStockStatus, priceDemand } from '../../src/domain/demand';
import type { DemandLine, Sku, SupplierResolution } from '../../src/domain/types';

describe('demand rules', () => {
  it.each([
    [40, 'OK'],
    [39, 'YELLOW'],
    [30, 'YELLOW'],
    [29, 'ORANGE'],
    [20, 'ORANGE'],
    [19, 'BELOW_MIN'],
    [10, 'BELOW_MIN'],
    [0, 'BELOW_MIN'],
  ] as const)('maps stock %s to %s for MIN=20 MAX=40', (stock, status) => {
    expect(calculateStockStatus(stock, 20, 40).status).toBe(status);
  });

  it.each([
    [0.0675, 'YELLOW'],
    [0.06749999999999999, 'ORANGE'],
    [0.0225, 'ORANGE'],
    [0.022499999999999996, 'LIGHT_RED'],
  ] as const)('compares the decimal coverage boundary for stock %s', (stock, status) => {
    expect(calculateStockStatus(stock, null, 0.09).status).toBe(status);
  });

  it('handles no norm, invalid norm and stock above MAX', () => {
    expect(calculateStockStatus(5, 2, null).status).toBe('NO_NORM');
    expect(calculateStockStatus(5, 50, 40).status).toBe('INVALID_NORM');
    expect(calculateStockStatus(50, 20, 40)).toMatchObject({ status: 'OK', deficitQty: 0 });
  });

  it('uses selected supplier price, then Min-Max fallback, then marks missing', () => {
    const base: DemandLine = {
      skuCode: 'SKU1',
      article: null,
      name: 'Товар',
      branch: 'Ленина',
      stock: 0,
      min: 1,
      max: 2,
      status: 'BELOW_MIN',
      deficitQty: 2,
      deficitPct: 1,
      networkDeficitQty: 2,
      referencePrice: 90,
    };
    const sku: Sku = {
      code: 'SKU1',
      article: null,
      name: 'Товар',
      referencePrice: 90,
      reportedTotalStock: 0,
    };
    const resolution: SupplierResolution = {
      skuCode: 'SKU1',
      selectedSupplier: 'Поставщик',
      status: 'AUTO_SINGLE',
      recommendedSupplier: 'Поставщик',
      candidates: [
        {
          supplier: 'Поставщик',
          skuCode: 'SKU1',
          skuName: 'Товар',
          unit: 'шт',
          purchaseQty: 10,
          purchaseAmount: 1000,
          weightedUnitCost: 100,
        },
      ],
    };

    expect(priceDemand([base], [sku], [resolution])[0]).toMatchObject({
      unitPrice: 100,
      priceSource: 'SUPPLIER_HISTORY',
      demandAmount: 200,
    });

    const withoutSupplierPrice = {
      ...resolution,
      candidates: [{ ...resolution.candidates[0]!, weightedUnitCost: null }],
    };
    expect(priceDemand([base], [sku], [withoutSupplierPrice])[0]?.priceSource).toBe(
      'MIN_MAX_FALLBACK',
    );

    expect(
      priceDemand(
        [{ ...base, referencePrice: null }],
        [{ ...sku, referencePrice: null }],
        [withoutSupplierPrice],
      )[0],
    ).toMatchObject({ unitPrice: null, priceSource: 'MISSING', demandAmount: null });
  });
});
