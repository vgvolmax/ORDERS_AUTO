import { beforeEach, describe, expect, it } from 'vitest';
import { historyOrderKey, type InvoiceHistoryRecord } from '../../src/domain/invoiceHistory';
import { appendInvoiceHistory, loadInvoiceHistory } from '../../src/persistence/invoiceHistory';
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
  await database.clear('invoiceHistory');
  database.close();
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
  it('keeps a reopened invoice history tied to its recorded legal entity', async () => {
    const at = '2026-11-25T09:00:00.000Z';
    const id = historyOrderKey('week', ['order']);
    const closed = {
      kind: 'closed' as const, at, supplier: { name: 'ООО Альфа', inn: '7801000101' },
      documents: [], orders: [{ id: 'order', branch: 'Ленина', exportedAt: null, positions: [{
        key: 'position', skuCode: '0001', article: 'VM-1', name: 'Товар', unit: 'шт',
        requested: 2, invoiced: 0, outcome: 'full' as const, reason: 'confirmed' as const,
        stockStatus: 'BELOW_MIN' as const, refusalAt: at,
      }] }],
    };
    const original: InvoiceHistoryRecord = { id, sourceId: 'week', basis: 'current', orderIds: ['order'], revisions: [closed] };
    await appendInvoiceHistory(original, 0);
    const reopened: InvoiceHistoryRecord = { ...original, revisions: [closed, { kind: 'reopened', at }] };
    await appendInvoiceHistory(reopened, 1);
    const differentIssuer: InvoiceHistoryRecord = {
      ...reopened, revisions: [...reopened.revisions, { ...closed, supplier: { name: 'ООО Бета', inn: '7801000202' } }],
    };
    await expect(appendInvoiceHistory(differentIssuer, 2)).rejects.toThrow('ИНН сохранённой сверки изменить нельзя.');
    expect(await loadInvoiceHistory()).toEqual([reopened]);
  });

});
