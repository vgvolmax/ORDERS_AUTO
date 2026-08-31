import { describe, expect, it } from 'vitest';
import {
  buildAutoSupplierOverrides,
  selectSupplierCandidate,
} from '../../src/domain/supplierAutomation';
import type {
  SupplierHistory,
  SupplierOverride,
  SupplierResolution,
} from '../../src/domain/types';

function candidate(
  supplier: string,
  price: number | null,
  qty = 1,
  amount = price ?? 0,
): SupplierHistory {
  return {
    supplier,
    skuCode: 'SKU1',
    skuName: 'Товар',
    unit: 'шт',
    purchaseQty: qty,
    purchaseAmount: amount,
    weightedUnitCost: price,
  };
}

function resolution(
  skuCode: string,
  candidates: SupplierHistory[],
  status: SupplierResolution['status'] = 'MANUAL_REQUIRED',
  selectedSupplier: string | null = null,
): SupplierResolution {
  return {
    skuCode,
    candidates: candidates.map((item) => ({ ...item, skuCode })),
    status,
    selectedSupplier,
    recommendedSupplier: candidates[0]?.supplier ?? null,
  };
}

describe('selectSupplierCandidate', () => {
  it('chooses the lowest valid historical unit price', () => {
    const chosen = selectSupplierCandidate(
      resolution('SKU1', [
        candidate('Большой объём', 120, 100, 12_000),
        candidate('Минимальная цена', 90, 2, 180),
      ]),
      'MIN_PRICE',
    );

    expect(chosen?.supplier).toBe('Минимальная цена');
  });

  it('ignores missing, zero and negative prices', () => {
    const chosen = selectSupplierCandidate(
      resolution('SKU1', [
        candidate('Нет цены', null, 100, 10_000),
        candidate('Нулевая', 0, 100, 0),
        candidate('Отрицательная', -10, 100, -1_000),
        candidate('Валидная', 110, 1, 110),
      ]),
      'MIN_PRICE',
    );

    expect(chosen?.supplier).toBe('Валидная');
  });

  it('breaks equal-price ties by quantity, then amount, then supplier name', () => {
    expect(
      selectSupplierCandidate(
        resolution('SKU1', [
          candidate('A', 100, 5, 500),
          candidate('B', 100, 8, 800),
        ]),
        'MIN_PRICE',
      )?.supplier,
    ).toBe('B');

    expect(
      selectSupplierCandidate(
        resolution('SKU1', [
          candidate('A', 100, 8, 700),
          candidate('B', 100, 8, 900),
        ]),
        'MIN_PRICE',
      )?.supplier,
    ).toBe('B');

    expect(
      selectSupplierCandidate(
        resolution('SKU1', [
          candidate('Бета', 100, 8, 900),
          candidate('Альфа', 100, 8, 900),
        ]),
        'MIN_PRICE',
      )?.supplier,
    ).toBe('Альфа');
  });
});

describe('buildAutoSupplierOverrides', () => {
  const resolutions = [
    resolution('SKU1', [candidate('A', 100), candidate('B', 90)]),
    resolution('SKU2', [candidate('A', 80), candidate('B', 70)]),
    resolution('SKU3', [candidate('A', 60), candidate('B', 50)]),
  ];

  const build = (
    scope: 'ALL' | 'SELECTED' | 'EXCEPT_SELECTED',
    selectedSkuCodes: string[] = [],
    currentOverrides: SupplierOverride[] = [],
    overwriteManual = false,
  ) =>
    buildAutoSupplierOverrides({
      resolutions,
      currentOverrides,
      selectedSkuCodes,
      scope,
      strategy: 'MIN_PRICE',
      overwriteManual,
      now: '2026-08-28T12:00:00.000Z',
    });

  it('supports ALL, SELECTED and EXCEPT_SELECTED scopes', () => {
    expect(build('ALL').map((item) => item.skuCode)).toEqual([
      'SKU1',
      'SKU2',
      'SKU3',
    ]);
    expect(build('SELECTED', ['SKU2']).map((item) => item.skuCode)).toEqual([
      'SKU2',
    ]);
    expect(
      build('EXCEPT_SELECTED', ['SKU2']).map((item) => item.skuCode),
    ).toEqual(['SKU1', 'SKU3']);
  });

  it('writes AUTO source and the selected minimum-price supplier', () => {
    expect(build('SELECTED', ['SKU1'])).toEqual([
      {
        skuCode: 'SKU1',
        supplier: 'B',
        source: 'AUTO',
        updatedAt: '2026-08-28T12:00:00.000Z',
      },
    ]);
  });

  it('protects an active manual override unless overwrite is explicit', () => {
    const manual = resolution(
      'SKU1',
      [candidate('A', 100), candidate('B', 90)],
      'MANUAL_SELECTED',
      'A',
    );
    const autoCandidates = [manual, resolutions[1]!, resolutions[2]!];
    const currentOverrides: SupplierOverride[] = [
      {
        skuCode: 'SKU1',
        supplier: 'A',
        source: 'MANUAL',
        updatedAt: '2026-08-27T12:00:00.000Z',
      },
    ];

    const protectedResult = buildAutoSupplierOverrides({
      resolutions: autoCandidates,
      currentOverrides,
      selectedSkuCodes: [],
      scope: 'ALL',
      strategy: 'MIN_PRICE',
      overwriteManual: false,
      now: '2026-08-28T12:00:00.000Z',
    });
    expect(protectedResult.map((item) => item.skuCode)).toEqual(['SKU2', 'SKU3']);

    const overwriteResult = buildAutoSupplierOverrides({
      resolutions: autoCandidates,
      currentOverrides,
      selectedSkuCodes: [],
      scope: 'ALL',
      strategy: 'MIN_PRICE',
      overwriteManual: true,
      now: '2026-08-28T12:00:00.000Z',
    });
    expect(overwriteResult.find((item) => item.skuCode === 'SKU1')?.supplier).toBe(
      'B',
    );
  });

  it('treats legacy overrides without source as manual', () => {
    const manual = resolution(
      'SKU1',
      [candidate('A', 100), candidate('B', 90)],
      'MANUAL_SELECTED',
      'A',
    );
    const legacy: SupplierOverride[] = [
      {
        skuCode: 'SKU1',
        supplier: 'A',
        updatedAt: '2026-08-27T12:00:00.000Z',
      },
    ];

    const result = buildAutoSupplierOverrides({
      resolutions: [manual],
      currentOverrides: legacy,
      selectedSkuCodes: [],
      scope: 'ALL',
      strategy: 'MIN_PRICE',
      overwriteManual: false,
      now: '2026-08-28T12:00:00.000Z',
    });

    expect(result).toEqual([]);
  });
});
