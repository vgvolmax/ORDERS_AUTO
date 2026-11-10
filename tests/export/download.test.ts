import JSZip from 'jszip';
import { expect, it, vi } from 'vitest';
import type { Order } from '../../src/domain/types';
import { downloadReadyOrdersZip } from '../../src/export/download';

it('keeps a CSV for every order whose sanitized filenames collide', async () => {
  const orders: Order[] = ['Склад/1', 'Склад:1', 'СКЛАД_1'].map((branch, index) => ({
    id: branch,
    branch,
    supplier: 'Поставщик',
    totalQty: 1,
    totalAmount: 20,
    belowThreshold: false,
    status: 'READY',
    blockers: [],
    lines: [{
      skuCode: 'SKU-' + (index + 1),
      article: null,
      name: 'Товар',
      branch,
      supplier: 'Поставщик',
      calculatedQty: 1,
      orderQty: 1,
      unit: 'шт',
      unitPrice: 20,
      priceSource: 'MIN_MAX',
      amount: 20,
      warnings: [],
      stock: 0,
      min: 1,
      max: 1,
    }],
  }));
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:orders');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  try {
    await downloadReadyOrdersZip(orders);
    const blob = createObjectURL.mock.calls[0]![0];
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const entries = Object.values(zip.files);
    expect(new Set(entries.map(({ name }) => name.toLowerCase())).size).toBe(3);
    const csvs = await Promise.all(entries.map((entry) => entry.async('string')));
    expect(csvs.map((csv) => csv.split('\r\n')[1]?.split(';')[0]).sort()).toEqual([
      'SKU-1', 'SKU-2', 'SKU-3',
    ]);
  } finally {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});
