import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/app/initialState';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { snapshot, config } from '../fixtures/rebalanceFixtures';
function state() {
  const s = createInitialState({ snapshotId: 'snapshot-1' }), data = snapshot();
  s.minMax = { skus: [{ code: '00001', name: 'Товар', article: null, referencePrice: 100, reportedTotalStock: null }], branches: data.branches.map((b) => b.name),
    branchStocks: data.stocks.map((r) => ({ skuCode: r.skuCode, branch: data.branches.find((b) => b.id === r.branchId)!.name, stock: r.stock, min: r.min, max: r.max })) };
  s.suppliers = { suppliers: ['S'], history: [{ skuCode: '00001', supplier: 'S', skuName: 'Товар', unit: 'шт', purchaseQty: 1, purchaseAmount: 100, weightedUnitCost: 100 }] };
  s.rebalance = { ...s.rebalance, registry: data.branches, policies: [{ skuCode: '00001', unit: 'шт', quantityStep: 1 }], config: config() };
  s.rebalance.proposal = createProposal(s); return s;
}
describe('durable accepted transfer app commands', () => {
  it('failed acceptance save leaves quantities and orders unchanged, then commits all changes on retry', async () => {
    const initial = state(), line = initial.rebalance.proposal!.transfers[0]!, changes: unknown[] = []; let fail = true;
    const session = createWorkspaceSession({ initial, save: async () => { if (fail) throw new Error('quota'); }, publish: (s) => changes.push(s) });
    const command = (s: typeof initial) => prepareAcceptedChange(s, { kind: 'accept', ids: [line.sourceLineId], expectedRevision: 0 }).patch;
    await expect(session.commit(command)).rejects.toThrow('quota');
    expect(session.getState().rebalance.accepted).toEqual([]); expect(derive(session.getState()).projection.orders[0]!.totalQty).toBe(50);
    fail = false; await session.commit(command);
    expect(session.getState().rebalance.accepted).toHaveLength(1); expect(derive(session.getState()).projection.orders[0]!.totalQty).toBe(30); expect(changes).toHaveLength(1);
  });
  it('preserves accepted movements during recalculation and rejects old revisions or changed conditions', () => {
    const initial = state(), line = initial.rebalance.proposal!.transfers[0]!;
    const accepted = prepareAcceptedChange(initial, { kind: 'accept', ids: [line.sourceLineId], expectedRevision: 0 });
    const next = { ...initial, ...accepted.patch };
    expect(createProposal(next).transfers).toEqual([]); expect(next.rebalance.accepted).toHaveLength(1);
    expect(() => prepareAcceptedChange(next, { kind: 'revoke', ids: ['t'], expectedRevision: 0 })).toThrow('REVISION_CONFLICT');
    initial.rebalance.config = config({ receiverPct: 0 });
    expect(() => prepareAcceptedChange(initial, { kind: 'accept', ids: [line.sourceLineId], expectedRevision: 0 })).toThrow('STALE_PROPOSAL');
  });
});
