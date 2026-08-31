import { describe, expect, it } from 'vitest';
import { resolveSuppliers } from '../../src/domain/suppliers';
import type { SupplierHistory } from '../../src/domain/types';

const history: SupplierHistory[] = [
  {
    supplier: 'Б',
    skuCode: 'SKU1',
    skuName: 'Товар',
    unit: 'шт',
    purchaseQty: 5,
    purchaseAmount: 500,
    weightedUnitCost: 100,
  },
  {
    supplier: 'А',
    skuCode: 'SKU1',
    skuName: 'Товар',
    unit: 'шт',
    purchaseQty: 10,
    purchaseAmount: 900,
    weightedUnitCost: 90,
  },
];

describe('resolveSuppliers', () => {
  it('does not silently select when there are multiple candidates', () => {
    const result = resolveSuppliers(history, [], ['SKU1'])[0];
    expect(result).toMatchObject({
      status: 'MANUAL_REQUIRED',
      selectedSupplier: null,
      recommendedSupplier: 'А',
    });
  });

  it('auto-selects a single candidate and retains unresolved SKU', () => {
    const single = resolveSuppliers([history[0]!], [], ['SKU1', 'SKU2']);
    expect(single.find((item) => item.skuCode === 'SKU1')?.status).toBe('AUTO_SINGLE');
    expect(single.find((item) => item.skuCode === 'SKU2')?.status).toBe('UNRESOLVED');
  });

  it('distinguishes manual, automatic and stale persisted overrides', () => {
    const manual = resolveSuppliers(
      history,
      [{ skuCode: 'SKU1', supplier: 'Б', updatedAt: '2026-08-28T00:00:00Z' }],
      ['SKU1'],
    )[0];
    expect(manual).toMatchObject({
      status: 'MANUAL_SELECTED',
      selectedSupplier: 'Б',
    });

    const automatic = resolveSuppliers(
      history,
      [
        {
          skuCode: 'SKU1',
          supplier: 'Б',
          source: 'AUTO',
          updatedAt: '2026-08-28T00:00:00Z',
        },
      ],
      ['SKU1'],
    )[0];
    expect(automatic).toMatchObject({
      status: 'AUTO_SELECTED',
      selectedSupplier: 'Б',
    });

    const stale = resolveSuppliers(
      history,
      [{ skuCode: 'SKU1', supplier: 'Нет больше', updatedAt: '2026-08-28T00:00:00Z' }],
      ['SKU1'],
    )[0];
    expect(stale).toMatchObject({ status: 'STALE_OVERRIDE', selectedSupplier: null });
  });
});
