import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/app/initialState';
import { createWorkspaceSession, stateFromWorkspace, workspaceFromState } from '../../src/app/workspaceSession';
import {
  createProposal,
  prepareAcceptedChange,
  prepareTransferQuantityEdit,
  validateTransferRestoration,
} from '../../src/app/rebalanceActions';
import { seedSupplierAssignments } from '../../src/domain/supplierAssignments';
import { derive } from '../../src/app/selectors';
import { snapshot, config } from '../fixtures/rebalanceFixtures';
function state() {
  const s = createInitialState({ snapshotId: 'snapshot-1' }),
    data = snapshot();
  s.minMax = {
    skus: [
      {
        code: '00001',
        name: 'Товар',
        article: null,
        referencePrice: 100,
        reportedTotalStock: null,
      },
    ],
    branches: data.branches.map((b) => b.name),
    branchStocks: data.stocks.map((r) => ({
      skuCode: r.skuCode,
      branch: data.branches.find((b) => b.id === r.branchId)!.name,
      stock: r.stock,
      min: r.min,
      max: r.max,
    })),
  };
  s.suppliers = {
    suppliers: ['ИП Баранов Роман Борисович'],
    history: [
      {
        skuCode: '00001',
        supplier: 'ИП Баранов Роман Борисович',
        skuName: 'Товар',
        unit: 'шт',
        purchaseQty: 1,
        purchaseAmount: 100,
        weightedUnitCost: 100,
      },
    ],
  };
  s.supplierAssignments = seedSupplierAssignments(s.suppliers.history);
  s.rebalance = {
    ...s.rebalance,
    registry: data.branches,
    policies: [{ skuCode: '00001', unit: 'шт', quantityStep: 1 }],
    config: config({ receiverPct: 25 }),
  };
  s.rebalance.proposal = createProposal(s);
  return s;
}
describe('durable accepted transfer app commands', () => {
  it('failed acceptance save leaves quantities and orders unchanged, then commits all changes on retry', async () => {
    const initial = state(),
      line = initial.rebalance.proposal!.transfers[0]!,
      changes: unknown[] = [];
    let fail = true;
    const session = createWorkspaceSession({
      initial,
      save: async () => {
        if (fail) throw new Error('quota');
      },
      publish: (s) => changes.push(s),
    });
    const command = (s: typeof initial) =>
      prepareAcceptedChange(s, {
        kind: 'accept',
        ids: [line.sourceLineId],
        expectedRevision: 0,
      }).patch;
    await expect(session.commit(command)).rejects.toThrow('quota');
    expect(session.getState().rebalance.accepted).toEqual([]);
    expect(derive(session.getState()).projection.orders[0]!.totalQty).toBe(50);
    fail = false;
    await session.commit(command);
    expect(session.getState().rebalance.accepted).toHaveLength(1);
    expect(derive(session.getState()).projection.orders[0]!.totalQty).toBe(30);
    expect(changes).toHaveLength(1);
  });
  it('preserves accepted movements during recalculation, rejects old revisions and permits changed search conditions', () => {
    const initial = state(),
      line = initial.rebalance.proposal!.transfers[0]!;
    const accepted = prepareAcceptedChange(initial, {
      kind: 'accept',
      ids: [line.sourceLineId],
      expectedRevision: 0,
    });
    const next = { ...initial, ...accepted.patch };
    expect(createProposal(next).transfers).toEqual([]);
    expect(next.rebalance.accepted).toHaveLength(1);
    expect(() =>
      prepareAcceptedChange(next, {
        kind: 'revoke',
        ids: ['t'],
        expectedRevision: 0,
      }),
    ).toThrow('REVISION_CONFLICT');
    initial.rebalance.config = config({ receiverPct: 0 });
    expect(() =>
      prepareAcceptedChange(initial, {
        kind: 'accept',
        ids: [line.sourceLineId],
        expectedRevision: 0,
      }),
    ).not.toThrow();
  });
});

function multiDirectionState() {
  const s = structuredClone(state());
  s.minMax!.branches.push('Второй донор', 'Второй получатель');
  s.rebalance.registry.push(
    { id: 'D2', name: 'Второй донор', active: true, aliases: [] },
    { id: 'R2', name: 'Второй получатель', active: true, aliases: [] },
  );
  Object.assign(s.minMax!.branchStocks[0]!, { stock: 24, min: 8, max: 8 });
  Object.assign(s.minMax!.branchStocks[1]!, { stock: 0, min: 10, max: 10 });
  s.minMax!.branchStocks.push(
    { skuCode: '00001', branch: 'Второй донор', stock: 14, min: 10, max: 10 },
    { skuCode: '00001', branch: 'Второй получатель', stock: 0, min: 10, max: 10 },
  );
  s.rebalance.config = config({
    transferAmountFilter: { enabled: true, threshold: 300 },
    routeConfig: { mode: 'SELECTIVE', pairs: [
      { branchAId: 'D', branchBId: 'R', direction: 'A_TO_B' },
      { branchAId: 'D', branchBId: 'R2', direction: 'A_TO_B' },
      { branchAId: 'D2', branchBId: 'R', direction: 'A_TO_B' },
    ] },
  });
  s.rebalance.proposal = createProposal(s);
  return s;
}

describe('operator changes to proposed quantities', () => {
  it.each([true, false])('accepts untouched routes in either order after a manual increase (edited first: %s)', (editedFirst) => {
    let s = multiDirectionState();
    const [main, otherOut, otherIn] = [['D', 'R'], ['D', 'R2'], ['D2', 'R']].map(([from, to]) =>
      s.rebalance.proposal!.transfers.find((t) => t.fromBranchId === from && t.toBranchId === to)!,
    );
    expect([main!.qty, otherOut!.qty, otherIn!.qty]).toEqual([6, 10, 4]);
    expect(() => prepareTransferQuantityEdit(s, main!.sourceLineId, 15)).toThrow('TRANSFER_STOCK_RESERVED');
    s = { ...s, ...prepareTransferQuantityEdit(s, main!.sourceLineId, 14) };
    expect(derive(s).purchaseDemand.find((row) => row.branch === 'Получатель')!.purchaseQty).toBe(10);
    expect(s.rebalance.proposal!.transfers.find((t) => t.sourceLineId === main!.sourceLineId)).toMatchObject({ qty: 14, originalQty: 6 });
    const ordered = editedFirst ? [main!, otherOut!, otherIn!] : [otherOut!, otherIn!, main!];
    for (const line of ordered) {
      s = { ...s, ...prepareAcceptedChange(s, { kind: 'accept', ids: [line.sourceLineId], expectedRevision: s.rebalance.acceptedRevision }).patch };
    }
    expect(s.rebalance.accepted.find((t) => t.sourceLineId === main!.sourceLineId)).toMatchObject({ qty: 14, originalQty: 6 });
    expect(derive(s).purchaseDemand.map((row) => [row.branch, row.projectedStock, row.purchaseQty])).toEqual([
      ['Донор', 0, 8], ['Получатель', 18, 0], ['Второй донор', 10, 0], ['Второй получатель', 10, 0],
    ]);
    expect(createProposal(s).exclusions.every((issue) => !issue.code.startsWith('ACCEPTED_CAP'))).toBe(true);
  });

  it('accepts an edited line below a changed search threshold and preserves quantities on reload', () => {
    let s = multiDirectionState();
    const line = s.rebalance.proposal!.transfers.find((t) => t.fromBranchId === 'D' && t.toBranchId === 'R')!;
    s.rebalance.config.transferAmountFilter = { enabled: true, threshold: 700 };
    s = { ...s, ...prepareTransferQuantityEdit(s, line.sourceLineId, 2) };
    s = stateFromWorkspace(workspaceFromState(s));
    expect(s.rebalance.proposal!.transfers.find((t) => t.sourceLineId === line.sourceLineId)).toMatchObject({ qty: 2, originalQty: 6 });
    const patch = prepareAcceptedChange(s, { kind: 'accept', ids: [line.sourceLineId], expectedRevision: 0 }).patch;
    expect(patch.rebalance!.accepted[0]).toMatchObject({ qty: 2, originalQty: 6 });
  });

  it('frees rejected quantities and blocks restoring a direction if it now exceeds physical stock', () => {
    let s = multiDirectionState();
    const main = s.rebalance.proposal!.transfers.find((t) => t.fromBranchId === 'D' && t.toBranchId === 'R')!;
    const other = s.rebalance.proposal!.transfers.find((t) => t.toBranchId === 'R2')!;
    s.rebalance.rejectedLineIds = [other.sourceLineId];
    s = { ...s, ...prepareTransferQuantityEdit(s, main.sourceLineId, 24) };
    expect(() => validateTransferRestoration(s, other.sourceLineId, [])).toThrow('TRANSFER_STOCK_RESERVED');
    expect(s.rebalance.rejectedLineIds).toEqual([other.sourceLineId]);
    s = { ...s, ...prepareTransferQuantityEdit(s, main.sourceLineId, 14) };
    expect(() => validateTransferRestoration(s, other.sourceLineId, [])).not.toThrow();
  });
});
