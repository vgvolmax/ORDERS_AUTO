import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { buildAcceptedTransfersWorkbook } from '../../src/export/transferWorkbook';
import type {
  TransferDocument,
  TransferDocumentLine,
} from '../../src/features/rebalancing/transferDocuments';

function line(changes: Partial<TransferDocumentLine> = {}): TransferDocumentLine {
  return {
    id: 'line',
    sourceLineId: 'line',
    transferId: 'accepted',
    skuCode: '00010',
    article: '00002',
    name: 'Труба',
    qty: 0.25,
    unit: 'м',
    unitPrice: 0,
    amount: 0,
    decision: 'ACCEPTED',
    selected: false,
    from: null,
    to: null,
    ...changes,
  };
}

function route(fromName: string, toName: string, lines: TransferDocumentLine[]): TransferDocument {
  return {
    id: JSON.stringify([fromName, toName]),
    fromBranchId: fromName,
    toBranchId: toName,
    fromName,
    toName,
    lines,
    skuCount: 0,
    totalAmount: null,
    totalsByUnit: [],
  };
}

async function load(documents: TransferDocument[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildAcceptedTransfersWorkbook(documents));
  return workbook;
}

it('writes complete accepted directions with a summary and typed values', async () => {
  const documents = [
    route('Донор', 'Получатель', [
      line(),
      line({ skuCode: '00001', article: '=2+2', unitPrice: null, amount: null }),
      line({ skuCode: 'proposal', decision: 'PROPOSED' }),
      line({ skuCode: 'rejected', decision: 'REJECTED' }),
      line({ skuCode: 'zero-qty', qty: 0 }),
    ]),
    route('Получатель', 'Донор', [line({ unitPrice: 12.5, amount: 3.125 })]),
    route('Третий', 'Донор', [line({ decision: 'REJECTED' })]),
  ];
  const workbook = await load(documents);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    'Сводка',
    'Донор → Получатель',
    'Получатель → Донор',
  ]);
  const summary = workbook.worksheets[0]!;
  const direction = workbook.worksheets[1]!;
  expect(summary.getRow(6).values).toEqual([undefined, 'Донор', 'Получатель', 2, 2]);
  expect(summary.getRow(7).values).toEqual([undefined, 'Получатель', 'Донор', 1, 1, 3.125]);
  expect(summary.getCell('E6').value).toBeNull();
  expect(summary.getCell('E8').value).toBeNull();
  expect(direction.getRow(6).values).toEqual([undefined, '00010', '00002', 'Труба', 0.25, 'м', 0, 0]);
  expect(direction.getRow(7).values).toEqual([undefined, '00001', '=2+2', 'Труба', 0.25, 'м']);
  expect(direction.getCell('F7').value).toBeNull();
  expect(direction.getCell('G7').value).toBeNull();
  expect(direction.getCell('A8').value).toBe('ИТОГО');
  expect(direction.getCell('A6').numFmt).toBe('@');
  expect(direction.getImages()).toHaveLength(1);
});

it('keeps both sides visible in safe unique worksheet names for long or colliding routes', async () => {
  const documents = [
    route('Подразделение/Отправитель номер один', 'Приёмное подразделение номер один', [line()]),
    route('ПОДРАЗДЕЛЕНИЕ\\Отправитель номер один', 'Приёмное подразделение номер один', [line()]),
    route('Подразделение[Отправитель номер два]', 'Приёмное подразделение номер один', [line()]),
  ];
  const workbook = await load(documents);
  const sheets = workbook.worksheets.slice(1);
  const names = sheets.map((sheet) => sheet.name);
  expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(documents.length);
  for (const name of names) {
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).toMatch(/^подразделение.* → Приёмно/iu);
    expect(name).not.toMatch(/[\[\]:*?/\\]/u);
  }
  expect(sheets.map((sheet) => sheet.getCell('A3').value)).toEqual(
    documents.map((doc) => `${doc.fromName} → ${doc.toName}`),
  );
  expect((await load(documents)).worksheets.slice(1).map((sheet) => sheet.name)).toEqual(names);
});
