import { expect, it } from 'vitest';
import {
  transferToCsv,
  transferCsvFilename,
} from '../../src/export/transferCsv';
import type {
  TransferDocument,
  TransferDocumentLine,
} from '../../src/features/rebalancing/transferDocuments';

const line = (
  changes: Partial<TransferDocumentLine> = {},
): TransferDocumentLine => ({
  id: 'a',
  sourceLineId: 'a',
  transferId: 'accepted',
  skuCode: '00001',
  article: 'A;1',
  name: 'Труба "PPR"\nметровая',
  qty: 0.25,
  unit: 'м',
  unitPrice: null,
  amount: null,
  decision: 'ACCEPTED',
  selected: false,
  from: null,
  to: null,
  ...changes,
});
const doc = (lines: TransferDocumentLine[]): TransferDocument => ({
  id: '["a","b"]',
  fromBranchId: 'a',
  toBranchId: 'b',
  fromName: 'Донор / А',
  toName: 'Ленина',
  lines,
  skuCount: lines.length,
  totalAmount: null,
  totalsByUnit: [],
});
it('exports only accepted positive quantities with exact identity, decimal units, BOM and CSV escaping', () => {
  const data = doc([
    line(),
    line({
      id: 'b',
      skuCode: 'PROPOSED',
      decision: 'PROPOSED',
      selected: true,
    }),
    line({ id: 'c', skuCode: 'REJECTED', decision: 'REJECTED' }),
    line({ id: 'd', skuCode: 'ZERO_QTY', qty: 0 }),
  ]);
  const before = structuredClone(data);
  expect(transferToCsv(data)).toBe(
    '\ufeffКод;Артикул;Номенклатура;Отправитель;Получатель;Количество;Ед.;Цена MIN/MAX;Сумма\r\n00001;"A;1";"Труба ""PPR""\nметровая";Донор / А;Ленина;0.25;м;;\r\n',
  );
  expect(data).toEqual(before);
});
it('preserves known zero price and exports accepted lines without depending on selection', () => {
  const csv = transferToCsv(doc([line({ unitPrice: 0, amount: 0 })]));
  expect(csv).toContain(';0.25;м;0;0\r\n');
  expect(
    transferToCsv(doc([line({ decision: 'PROPOSED' })])).split('\r\n'),
  ).toHaveLength(2);
});
it('uses a safe directed route and local date in the movement filename', () => {
  expect(transferCsvFilename(doc([]), new Date(2026, 9, 23, 1))).toBe(
    'Перемещение__Донор _ А__Ленина__2026-10-23.csv',
  );
});
