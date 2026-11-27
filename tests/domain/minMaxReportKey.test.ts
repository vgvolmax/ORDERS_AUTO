import { expect, it } from 'vitest';
import { minMaxReportKey } from '../../src/domain/minMaxReportKey';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { buildMinMaxFixture } from '../fixtures/workbookBuilders';
import * as XLSX from 'xlsx';

it('identifies the same parsed report after resaving the workbook and reordering report blocks', async () => {
  const input = buildMinMaxFixture();
  const workbook = XLSX.read(input);
  workbook.Props = { ...workbook.Props, Author: 'Другой автор' };
  const copy = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const original = parseMinMaxWorkbook(input);
  const saved = parseMinMaxWorkbook(copy);
  expect(original.data).not.toBeNull();
  const reordered = {
    skus: [...saved.data!.skus].reverse(),
    branchStocks: [...saved.data!.branchStocks].reverse(),
    branches: [...saved.data!.branches].reverse(),
  };
  await expect(minMaxReportKey(reordered, saved.issues))
    .resolves.toEqual(await minMaxReportKey(original.data!, original.issues));
});

it('distinguishes business values, including leading zeroes and absent norms', async () => {
  const data = {
    skus: [{ code: '001', article: '01', name: 'Товар', referencePrice: 100, reportedTotalStock: 0 }],
    branchStocks: [{ skuCode: '001', branch: 'Склад', stock: 0, min: null, max: 3 }],
    branches: ['Склад'],
  };
  const key = await minMaxReportKey(data, []);
  expect(await minMaxReportKey({ ...data, branchStocks: [{ ...data.branchStocks[0]!, min: 0 }] }, [])).not.toBe(key);
  expect(await minMaxReportKey({ ...data, skus: [{ ...data.skus[0]!, referencePrice: 101 }] }, [])).not.toBe(key);
  expect(await minMaxReportKey({ ...data, skus: [{ ...data.skus[0]!, code: '01' }] }, [])).not.toBe(key);
});
