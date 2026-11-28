import { expect, it } from 'vitest';
import { derive } from '../../src/app/selectors';
import { createWorkspaceSession, stateFromWorkspace, workspaceFromState } from '../../src/app/workspaceSession';
import { WorkspaceConflictError } from '../../src/domain/workspace';
import { checkOrderLines, checkOrderReview } from '../../src/features/orders/orderCollaboration';
import { applyOrderQtyChange } from '../../src/domain/orderWorkflow';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { seedSupplierAssignments } from '../../src/domain/supplierAssignments';
import { baseState } from '../ui/renderWithStore';

function teamSession() {
  const initial = baseState({ workspaceRevision: 0, page: 'orders' });
  initial.minMax!.skus.push({
    ...initial.minMax!.skus[0]!, code: 'SKU2', article: 'A-2', name: 'Товар 2',
  });
  initial.minMax!.branchStocks.push({ skuCode: 'SKU2', branch: 'Ленина', stock: 3, min: 5, max: 10 });
  initial.suppliers!.history.push({ ...initial.suppliers!.history[0]!, skuCode: 'SKU2', skuName: 'Товар 2' });
  initial.supplierAssignments = seedSupplierAssignments(initial.suppliers!.history);
  let current = workspaceFromState(initial);
  const load = async () => stateFromWorkspace(structuredClone(current));
  const start = () => createWorkspaceSession({
    initial,
    async save(value, expected) {
      if (current.revision !== expected) throw new WorkspaceConflictError();
      current = structuredClone(value);
    },
    loadLatest: load,
    publish() {},
  });
  return { initial, start, load, saved: () => current };
}

type Session = ReturnType<typeof createWorkspaceSession>;
function edit(session: Session, branch: string, qty: number, skuCode = 'SKU1') {
  const orderId = derive(session.getState()).projection.orders.find((order) => order.branch === branch)!.id;
  return session.commit((state) => {
    const order = derive(state).projection.orders.find(({ id }) => id === orderId)!;
    return applyOrderQtyChange({ ...state, order, skuCode, qty });
  }, checkOrderLines([orderId], skuCode));
}

it('saves both quantity edits in different rows from two copies of the same session', async () => {
  const team = teamSession();
  const a = team.start();
  const b = team.start();
  await Promise.all([edit(a, 'Ленина', 2), edit(b, 'Ленина', 3, 'SKU2')]);
  expect(team.saved().data.edits).toEqual(expect.arrayContaining([
    { skuCode: 'SKU1', branch: 'Ленина', qty: 2 },
    { skuCode: 'SKU2', branch: 'Ленина', qty: 3 },
  ]));
  expect(team.saved().data.edits).toHaveLength(2);
  expect(Math.max(a.getState().workspaceRevision, b.getState().workspaceRevision)).toBe(2);
});

it('keeps a competing edit to the same cell and rejects the stale one', async () => {
  const team = teamSession();
  const a = team.start();
  const b = team.start();
  await edit(a, 'Ленина', 2);
  await expect(edit(b, 'Ленина', 3)).rejects.toThrow(/коллега/i);
  expect(team.saved().data.edits).toEqual([{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }]);
});

it('refuses to approve changed order contents, then refreshes without switching the local page', async () => {
  const team = teamSession();
  const a = team.start();
  const b = team.start();
  const orderId = derive(team.initial).projection.orders.find(({ branch }) => branch === 'Ленина')!.id;
  await edit(a, 'Ленина', 2);
  await expect(b.commit({ reviewedOrderIds: [orderId] }, checkOrderReview([orderId], true)))
    .rejects.toThrow(/состав/i);
  expect(team.saved().data.reviewedOrderIds).toEqual([]);
  b.transient({ page: 'suppliers' });
  await b.synchronize(team.load);
  expect(b.getState()).toMatchObject({ page: 'suppliers', workspaceRevision: 1, edits: [{ qty: 2 }] });
});

it('does not automatically retry a stale operation without an explicit dependency check', async () => {
  const team = teamSession();
  const a = team.start();
  const b = team.start();
  await edit(a, 'Ленина', 2);
  await expect(b.commit({ settings: { ...team.initial.settings, minimumOrderAmount: 1 } }))
    .rejects.toBeInstanceOf(WorkspaceConflictError);
  expect(team.saved().data.settings.minimumOrderAmount).toBe(team.initial.settings.minimumOrderAmount);
});

it('accepts the first snapshot of the same open document', async () => {
  const team = teamSession();
  const empty = baseState({ workspaceId: team.initial.workspaceId, workspaceRevision: -1, page: 'suppliers' });
  const session = createWorkspaceSession({ initial: empty, async save() {}, publish() {} });
  expect(empty.snapshotId).not.toBe(team.initial.snapshotId);
  await session.synchronize(team.load);
  expect(session.getState()).toMatchObject({
    snapshotId: team.initial.snapshotId,
    workspaceRevision: 0,
    page: 'suppliers',
  });
});

it('retries an independent order edit against a new catalog revision in the same session', async () => {
  const team = teamSession();
  const catalog = createSupplierCatalog(team.initial)!;
  const initial = { ...team.initial, catalog };
  const latest = { ...initial, catalog: { ...catalog, revision: catalog.revision + 1 } };
  let saved = false;
  let outdated = true;
  const session = createWorkspaceSession({
    initial,
    async save(value) {
      if (saved) throw new Error('Repeated save');
      if (value.data.edits.length > 0 && outdated)
        throw new WorkspaceConflictError();
      saved = true;
    },
    loadLatest: async () => { outdated = false; return latest; },
    publish() {},
  });
  await edit(session, 'Ленина', 2);
  expect(saved).toBe(true);
  expect(session.getState().edits).toEqual([{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }]);
});
