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
it('separates accepted from remaining proposals and exports current purchase totals and unknown money as blank', async () => {
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
    'Параметры',
  ]);
  expect(wb.getWorksheet('Принятые')!.getCell('D2').value).toBe(15);
  expect(wb.getWorksheet('Предложения')!.getCell('D2').value).toBe(20);
  expect(wb.getWorksheet('Принятые')!.getCell('F2').value).toBeNull();
  expect(wb.getWorksheet('Принятые')!.getCell('G2').value).toBeNull();
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
    expect(wb.getWorksheet('Получатель')!.getCell('D2').value).toBe(qty);
  }
});
