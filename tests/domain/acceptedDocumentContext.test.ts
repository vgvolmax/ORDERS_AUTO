import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { buildTransferDocuments } from '../../src/features/rebalancing/transferDocuments';
import { buildAcceptedDocuments } from '../../src/features/rebalancing/acceptedTransfersViewModel';
import { transfersToCsv } from '../../src/export/transferCsv';
import { buildAcceptedTransfersWorkbook } from '../../src/export/transferWorkbook';
import { buildRebalancingWorkbook } from '../../src/export/rebalancingWorkbook';

function accept(price: number | null = 100) {
  let state = rebalanceAppState();
  state.minMax!.skus[0]!.referencePrice = price;
  state.rebalance.proposal = createProposal(state);
  const id = state.rebalance.proposal.transfers[0]!.sourceLineId;
  state = { ...state, ...prepareAcceptedChange(state, { kind: 'accept', ids: [id], expectedRevision: 0 }).patch };
  return state;
}
function documents(state: ReturnType<typeof accept>, onlyAccepted = false) {
  const input = { accepted: state.rebalance.accepted, registry: state.rebalance.registry,
    policies: derive(state).quantityPolicies, skus: state.minMax!.skus, snapshot: derive(state).snapshot!.snapshot };
  return onlyAccepted ? buildAcceptedDocuments(input) : buildTransferDocuments({ ...input, proposal: state.rebalance.proposal,
    selected: [], rejected: [], query: '', scope: {} });
}
async function overview(state: ReturnType<typeof accept>) {
  const d = derive(state);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildRebalancingWorkbook({ snapshot: d.snapshot!.snapshot, config: state.rebalance.config,
    proposal: state.rebalance.proposal, accepted: state.rebalance.accepted, purchaseDemand: d.purchaseDemand,
    issues: [], workspaceId: state.workspaceId, exportedAt: '2026-11-12T10:00:00Z' }));
  return book;
}

it('freezes accepted identity, unit, price and branch names while pending rows use current data', async () => {
  const state = accept();
  const original = structuredClone(state.rebalance.accepted);
  state.minMax!.skus[0] = { ...state.minMax!.skus[0]!, name: 'Новое название', article: 'NEW', referencePrice: 200 };
  state.suppliers!.history[0]!.unit = 'упак';
  state.rebalance.registry[0]!.aliases.push(state.rebalance.registry[0]!.name);
  state.rebalance.registry[0]!.name = 'Новое подразделение';
  const docs = documents({ ...state });
  const lines = docs.flatMap(doc => doc.lines);
  expect(lines.find(line => line.decision === 'ACCEPTED')).toMatchObject({ article: 'A1', name: 'Товар для перемещения', unit: 'шт', unitPrice: 100, amount: 1500 });
  expect(lines.find(line => line.decision === 'PROPOSED')).toMatchObject({ article: 'NEW', name: 'Новое название', unit: 'упак', unitPrice: 200, amount: 7000 });
  const fixed = documents({ ...state }, true);
  expect(fixed[0]!.fromName).toBe('Донор А');
  const csv = transfersToCsv(fixed);
  expect(csv).toContain('Товар для перемещения');
  expect(csv).not.toContain('Новое название');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildAcceptedTransfersWorkbook(fixed));
  expect(book.worksheets[1]!.getRow(6).values).toEqual(expect.arrayContaining(['A1', 'Товар для перемещения', 'шт', 100, 1500]));
  const report = await overview({ ...state });
  expect(report.getWorksheet('Принятые')!.getRow(2).values).toEqual(expect.arrayContaining(['Донор А', 'шт', 100, 1500]));
  expect(report.getWorksheet('Предложения')!.getRow(2).values).toEqual(expect.arrayContaining(['упак', 200, 7000]));
  expect(state.rebalance.accepted).toEqual(original);
});

it.each([0, null])('preserves a frozen price of %s instead of taking a later known price', async price => {
  const state = accept(price);
  state.minMax!.skus[0]!.referencePrice = 999;
  expect(documents({ ...state }, true)[0]!.lines[0]!.unitPrice).toBe(price);
  const report = await overview({ ...state });
  expect(report.getWorksheet('Принятые')!.getRow(2).getCell(6).value).toBe(price);
});

it('captures current fields after revoke and reaccept, while preserving the original accepted record', () => {
  let state = accept();
  const original = structuredClone(state.rebalance.accepted[0]);
  state = { ...state, ...prepareAcceptedChange(state, { kind: 'revoke', ids: [state.rebalance.accepted[0]!.transferId], expectedRevision: 1 }).patch };
  state.minMax!.skus[0]!.referencePrice = 250;
  state.suppliers!.history[0]!.unit = 'упак';
  state.rebalance.proposal = createProposal({ ...state });
  state = { ...state, ...prepareAcceptedChange(state, { kind: 'accept', ids: [state.rebalance.proposal.transfers[0]!.sourceLineId], expectedRevision: 2 }).patch };
  expect(documents(state, true)[0]!.lines[0]).toMatchObject({ unit: 'упак', unitPrice: 250 });
  expect(original!.qty).toBe(15);
});
