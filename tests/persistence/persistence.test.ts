import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/persistence/db';
import { getSettings, saveSettings } from '../../src/persistence/settings';
import {
  getSupplierOverrides,
  saveSupplierOverride,
} from '../../src/persistence/supplierOverrides';

beforeEach(async () => {
  const database = await db();
  await database.clear('supplierOverrides');
  await database.clear('settings');
});

describe('IndexedDB persistence', () => {
  it('persists supplier overrides', async () => {
    await saveSupplierOverride({
      skuCode: 'SKU1',
      supplier: 'Поставщик',
      updatedAt: '2026-08-28T00:00:00Z',
    });

    expect(await getSupplierOverrides()).toEqual([
      {
        skuCode: 'SKU1',
        supplier: 'Поставщик',
        updatedAt: '2026-08-28T00:00:00Z',
      },
    ]);
  });

  it('persists order threshold settings', async () => {
    await saveSettings({ minimumOrderAmount: 10_000, thresholdMode: 'BRANCH_SUPPLIER' });
    expect(await getSettings()).toEqual({
      minimumOrderAmount: 10_000,
      thresholdMode: 'BRANCH_SUPPLIER',
    });
  });
});
