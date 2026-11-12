import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { buildRebalancingWorkbook } from '../../src/export/rebalancingWorkbook';
import { orderToCsv } from '../../src/export/csv';
import { buildSupplierWorkbook } from '../../src/export/supplierWorkbook';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it('exports excluded document direction, amount and threshold alongside retained partial coverage', async () => {
  const s = rebalanceAppState();
  s.minMax!.skus[0]!.referencePrice = 1000;
  s.minMax!.branchStocks.forEach((r, i) => {
    r.stock = [68, 62, 50][i]!;
    if (i === 2) r.min = 60;
  });
  s.rebalance.config.transferAmountFilter = { enabled: true, threshold: 5000 };
  s.rebalance.proposal = createProposal(s);
  const d = derive(s),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    await buildRebalancingWorkbook({
      snapshot: d.snapshot!.snapshot,
      config: s.rebalance.config,
      proposal: s.rebalance.proposal,
      accepted: [],
      purchaseDemand: d.purchaseDemand,
      issues: [],
      workspaceId: s.workspaceId,
      exportedAt: '2026-11-03T09:00:00Z',
    }),
  );
  expect(wb.getWorksheet('Предложения')!.rowCount).toBe(2);
  expect(wb.getWorksheet('Предложения')!.getCell('D2').value).toBe(8);
  expect(wb.getWorksheet('Исключения')!.getRow(2).values).toEqual([
    undefined,
    'TRANSFER_AMOUNT_FILTER',
    'WARNING',
    'SKU1',
    undefined,
    undefined,
    'Сумма SKU в перемещении ниже порога',
    'Донор Б',
    'Получатель',
    2000,
    5000,
  ]);
});
function state() {
  let s = rebalanceAppState();
  s.rebalance.proposal = createProposal(s);
  s = {
    ...s,
    ...prepareAcceptedChange(s, {
      kind: 'accept',
      ids: [s.rebalance.proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
  return s;
}
it('freezes accepted money while exporting current purchase totals and unknown pending money as blank', async () => {
  const s = state(),
    d = derive(s);
  d.snapshot!.snapshot.skus[0]!.referencePrice = null;
  const buffer = await buildRebalancingWorkbook({
    snapshot: d.snapshot!.snapshot,
    config: s.rebalance.config,
    proposal: s.rebalance.proposal,
    accepted: s.rebalance.accepted,
    purchaseDemand: d.purchaseDemand,
    issues: d.snapshot!.issues,
    workspaceId: s.workspaceId,
    exportedAt: '2026-10-21T10:00:00Z',
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  expect(wb.worksheets.map((s) => s.name)).toEqual([
    'Принятые',
    'Предложения',
    'Сводка',
    'Исключения',
    'Не распределено',
    'Получатели с остатком',
    'Параметры',
  ]);
  expect(wb.getWorksheet('Принятые')!.getCell('D2').value).toBe(15);
  expect(wb.getWorksheet('Предложения')!.getCell('D2').value).toBe(35);
  expect(wb.getWorksheet('Принятые')!.getCell('F2').value).toBe(100);
  expect(wb.getWorksheet('Принятые')!.getCell('G2').value).toBe(1500);
  expect(wb.getWorksheet('Предложения')!.getCell('F2').value).toBeNull();
  expect(wb.getWorksheet('Предложения')!.getCell('G2').value).toBeNull();
  const summary = wb.getWorksheet('Сводка')!;
  expect(summary.getRow(4).values).toEqual(
    expect.arrayContaining(['Получатель', 50, 35]),
  );
  expect(wb.getWorksheet('Параметры')!.getCell('B2').value).toBe(s.snapshotId);
});
it('supplier CSV/XLSX share the accepted projection; manual quantity remains the exported quantity', async () => {
  const s = state();
  for (const qty of [35, 40]) {
    s.edits =
      qty === 40 ? [{ skuCode: 'SKU1', branch: 'Получатель', qty }] : [];
    const order = derive({ ...s }).projection.orders[0]!;
    expect(order.lines[0]!.orderQty).toBe(qty);
    expect(orderToCsv(order)).toContain(`;${qty};`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await buildSupplierWorkbook('ИП Баранов Роман Борисович', [order]),
    );
    expect(wb.getWorksheet('Получатель')!.getCell('D9').value).toBe(qty);
  }
});

it('exports uncovered residual separately from partial proposals and recipient breakdown', async () => {
  const s = rebalanceAppState();
  s.minMax!.branchStocks[0]!.stock = 67;
  s.minMax!.branchStocks[1]!.stock = 65;
  s.minMax!.branchStocks[2]!.stock = 46;
  s.minMax!.branchStocks[2]!.min = 50;
  s.rebalance.proposal = createProposal(s);
  const d = derive(s),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    await buildRebalancingWorkbook({
      snapshot: d.snapshot!.snapshot,
      config: s.rebalance.config,
      proposal: s.rebalance.proposal,
      accepted: [],
      purchaseDemand: d.purchaseDemand,
      issues: [],
      workspaceId: s.workspaceId,
      exportedAt: '2026-10-29T10:00:00Z',
    }),
  );
  const skipped = wb.getWorksheet('Не распределено');
  expect(skipped).toBeDefined();
  expect(skipped!.getRow(2).values).toEqual(
    expect.arrayContaining(['SKU1', 14, 12, 2, 200]),
  );
  expect(wb.getWorksheet('Получатели с остатком')!.getRow(2).values).toEqual(
    expect.arrayContaining(['SKU1', 'Получатель', 14, 12, 2]),
  );
  expect(wb.getWorksheet('Предложения')!.rowCount).toBe(3);
});

it('exports exact decimal money for both proposals and uncovered quantities', async () => {
  const s = rebalanceAppState();
  s.minMax!.skus[0]!.referencePrice = 0.145;
  s.minMax!.branchStocks[0]!.stock = 63;
  s.minMax!.branchStocks[1]!.stock = 60;
  s.minMax!.branchStocks[2]!.stock = 54;
  s.minMax!.branchStocks[2]!.min = 60;
  s.rebalance.proposal = createProposal(s);
  const d = derive(s), wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildRebalancingWorkbook({
    snapshot: d.snapshot!.snapshot,
    config: s.rebalance.config,
    proposal: s.rebalance.proposal,
    accepted: [],
    purchaseDemand: d.purchaseDemand,
    issues: [],
    workspaceId: s.workspaceId,
    exportedAt: '2026-10-29T10:00:00Z',
  }));
  expect(wb.getWorksheet('Предложения')!.getCell('G2').value).toBe(0.435);
  expect(wb.getWorksheet('Не распределено')!.getCell('H2').value).toBe(0.435);
});

it('orders product rows in the report by their order in the MIN/MAX snapshot', async () => {
  const s = state();
  const d = derive(s);
  const snapshot = d.snapshot!.snapshot;
  const secondSku = { ...snapshot.skus[0]!, skuCode: 'SKU2' };
  snapshot.skus[0]!.skuCode = 'SKU10';
  snapshot.skus.push(secondSku);
  const accepted = ['SKU2', 'SKU10'].map((skuCode) => ({
    ...s.rebalance.accepted[0]!,
    skuCode,
    transferId: `accepted-${skuCode}`,
    sourceLineId: `accepted-${skuCode}`,
  }));
  const proposal = s.rebalance.proposal!;
  const transfers = ['SKU2', 'SKU10'].map((skuCode) => ({
    ...proposal.transfers[0]!,
    skuCode,
    sourceLineId: `proposal-${skuCode}`,
  }));
  const purchaseDemand = ['SKU2', 'SKU10'].map((skuCode) => ({
    ...d.purchaseDemand[0]!,
    skuCode,
  }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildRebalancingWorkbook({
    snapshot,
    config: s.rebalance.config,
    proposal: { ...proposal, transfers },
    accepted,
    purchaseDemand,
    issues: [],
    workspaceId: s.workspaceId,
    exportedAt: '2026-11-03T09:00:00Z',
  }));
  for (const name of ['Принятые', 'Предложения', 'Сводка']) {
    const sheet = wb.getWorksheet(name)!;
    expect([sheet.getCell('A2').value, sheet.getCell('A3').value]).toEqual(['SKU10', 'SKU2']);
  }
});
