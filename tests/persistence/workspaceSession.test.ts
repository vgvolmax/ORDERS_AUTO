import { describe, expect, it } from 'vitest';
import { baseState } from '../ui/renderWithStore';
import { seedSupplierAssignments } from '../../src/domain/supplierAssignments';
import { derive } from '../../src/app/selectors';
import { createInitialState } from '../../src/app/initialState';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import { workspaceFromState } from '../../src/app/workspaceSession';

it('restores legacy workspaces without accepted filters and persists the accepted tab independently of results', async () => {
  const legacy = baseState();
  legacy.rebalance.query = 'Старый поиск результатов';
  delete legacy.rebalance.acceptedFilters;
  let written: ReturnType<typeof workspaceFromState> | undefined;
  const session = createWorkspaceSession({
    initial: createInitialState(),
    publish: () => undefined,
    save: async (workspace) => {
      written = workspace;
    },
  });
  await session.restore(workspaceFromState(legacy));
  expect(session.getState().rebalance.acceptedFilters).toBeUndefined();
  await session.commit((s) => ({
    rebalance: {
      ...s.rebalance,
      tab: 'accepted',
      acceptedFilters: { query: 'SKU1', fromBranchId: '', toBranchId: 'b2' },
    },
  }));
  const saved = written!;
  const restored = createWorkspaceSession({
    initial: createInitialState(),
    publish: () => undefined,
    save: async () => undefined,
  });
  await restored.restore(saved);
  expect(restored.getState().rebalance).toMatchObject({
    tab: 'accepted',
    query: 'Старый поиск результатов',
    acceptedFilters: { query: 'SKU1', fromBranchId: '', toBranchId: 'b2' },
  });
  expect(legacy.rebalance.acceptedFilters).toBeUndefined();
});

describe('persist then publish workspace commands', () => {
  it('archives report replacement with a new snapshot and clears old decisions, while preserving settings', async () => {
    const initial = baseState({
      workspaceRevision: 3,
      reviewedOrderIds: ['x'],
      edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 99 }],
    });
    const saved: unknown[] = [];
    const session = createWorkspaceSession({
      initial,
      save: async (w) => {
        saved.push(w);
      },
      publish: () => undefined,
    });
    await session.commit({ minMax: structuredClone(initial.minMax) });
    const next = session.getState();
    expect(next.snapshotId).not.toBe(initial.snapshotId);
    expect(next.workspaceId).not.toBe(initial.workspaceId);
    expect(next.edits).toEqual([]);
    expect(next.reviewedOrderIds).toEqual([]);
    expect(next.rebalance.config).toEqual(initial.rebalance.config);
    expect(saved[0]).toMatchObject({
      previousActive: { workspaceId: initial.workspaceId, revision: 3 },
    });
  });
  it('invalidates neighboring supplier reviews after a manual quantity changes their shared threshold', async () => {
    const initial = baseState({
      settings: { minimumOrderAmount: 1000, thresholdMode: 'SUPPLIER_TOTAL' },
    });
    const ids = derive(initial).projection.orders.map((o) => o.id);
    initial.reviewedOrderIds = ids;
    initial.exportedOrderIds = ids;
    const session = createWorkspaceSession({
      initial,
      save: async () => undefined,
      publish: () => undefined,
    });
    await session.commit({
      edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 0 }],
    });
    expect(session.getState().reviewedOrderIds).toEqual([]);
    expect(session.getState().exportedOrderIds).toEqual([]);
  });

  it('reuses the purchasing basis and other suppliers while recalculating an edited supplier', async () => {
    const initial = baseState({
      settings: { minimumOrderAmount: 1000, thresholdMode: 'SUPPLIER_TOTAL' },
    });
    const otherSupplier = 'ИП Никишин Андрей Николаевич';
    initial.minMax!.skus.push({ ...initial.minMax!.skus[0]!, code: 'SKU2' });
    initial.minMax!.branchStocks.push({
      skuCode: 'SKU2',
      branch: 'Ленина',
      stock: 0,
      min: 5,
      max: 20,
    });
    initial.suppliers!.history.push({
      ...initial.suppliers!.history[0]!,
      skuCode: 'SKU2',
      supplier: otherSupplier,
    });
    initial.supplierAssignments = seedSupplierAssignments(initial.suppliers!.history);
    const before = derive(initial);
    const other = before.projection.orders.find(
      (order) => order.supplier === otherSupplier,
    )!;
    initial.reviewedOrderIds = before.projection.orders.map((order) => order.id);
    initial.exportedOrderIds = initial.reviewedOrderIds;
    const published: unknown[] = [];
    let rejectSave = true;
    const session = createWorkspaceSession({
      initial,
      save: async () => {
        if (rejectSave) throw new Error('quota');
      },
      publish: (state) => published.push(state),
    });
    const reduction = { edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 0 }] };
    await expect(session.commit(reduction)).rejects.toThrow('quota');
    expect(session.getState()).toBe(initial);
    expect(published).toHaveLength(0);

    rejectSave = false;
    await session.commit(reduction);
    const reduced = session.getState();
    const after = derive(reduced);
    expect(after.purchaseDemand).toBe(before.purchaseDemand);
    expect(
      after.projection.orders.find((order) => order.id === other.id)?.lines,
    ).toBe(other.lines);
    expect(after.projection.orders.slice(0, 2).map((order) => [
      order.totalAmount, order.belowThreshold,
    ])).toEqual([[0, true], [400, true]]);
    expect(reduced.reviewedOrderIds).toEqual([other.id]);
    expect(reduced.exportedOrderIds).toEqual([other.id]);

    await session.commit({
      edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 6.5 }],
    });
    const restored = derive(session.getState());
    expect(restored.purchaseDemand).toBe(before.purchaseDemand);
    expect(restored.projection.orders.slice(0, 2).map((order) => [
      order.totalAmount, order.belowThreshold,
    ])).toEqual([[650, false], [400, false]]);
    expect(restored.projection.orders.find((order) => order.id === other.id)).toMatchObject({
      reviewed: true, status: 'EXPORTED',
    });
  });

  it('reconciles legacy composite edit keys shared by two suppliers', async () => {
    const initial = baseState();
    const first = initial.suppliers!.history[0]!;
    const otherSupplier = 'ИП Никишин Андрей Николаевич';
    const sku = initial.minMax!.skus[0]!;
    initial.minMax!.skus = [
      { ...sku, code: 'A' },
      { ...sku, code: 'A\0B' },
    ];
    initial.minMax!.branches = ['B\0C', 'C'];
    initial.minMax!.branchStocks = [
      { skuCode: 'A', branch: 'B\0C', stock: 3, min: 5, max: 10 },
      { skuCode: 'A\0B', branch: 'C', stock: 3, min: 5, max: 10 },
    ];
    initial.suppliers!.history = [
      { ...first, skuCode: 'A' },
      { ...first, skuCode: 'A\0B', supplier: otherSupplier },
    ];
    initial.supplierAssignments = seedSupplierAssignments(initial.suppliers!.history);
    const ids = derive(initial).projection.orders.map((order) => order.id);
    initial.reviewedOrderIds = ids;
    initial.exportedOrderIds = ids;
    const session = createWorkspaceSession({
      initial,
      save: async () => undefined,
      publish: () => undefined,
    });

    await session.commit({ edits: [{ skuCode: 'A', branch: 'B\0C', qty: 4 }] });

    const current = session.getState();
    expect(
      derive(current).projection.orders.map((order) => order.totalQty),
    ).toEqual([4, 4]);
    expect(current.reviewedOrderIds).toEqual([]);
    expect(current.exportedOrderIds).toEqual([]);
  });

  it('does not publish a failed save and can retry without losing the current accepted ledger', async () => {
    const initial = createInitialState();
    const published: unknown[] = [];
    let fail = true;
    const session = createWorkspaceSession({
      initial,
      save: async () => {
        if (fail) throw new DOMException('quota', 'QuotaExceededError');
      },
      publish: (s) => published.push(s),
    });
    await expect(session.commit({ page: 'orders' })).rejects.toThrow('quota');
    expect(session.getState()).toBe(initial);
    expect(published).toEqual([]);
    fail = false;
    await session.commit({ page: 'orders' });
    expect(session.getState().page).toBe('orders');
    expect(published).toHaveLength(1);
  });
  it('serializes rapid functional updates against the latest committed revision', async () => {
    const revisions: number[] = [];
    const session = createWorkspaceSession({
      initial: createInitialState(),
      save: async (w) => {
        revisions.push(w.revision);
      },
      publish: () => undefined,
    });
    await Promise.all([
      session.commit((s) => ({ uiPreferences: { ...s.uiPreferences, a: 1 } })),
      session.commit((s) => ({ uiPreferences: { ...s.uiPreferences, b: 2 } })),
    ]);
    expect(revisions).toEqual([0, 1]);
    expect(session.getState().uiPreferences).toEqual({ a: 1, b: 2 });
  });
});

it('restores an archived complete workspace as a new active copy without resetting accepted decisions', async () => {
  const old = baseState({
    workspaceRevision: 0,
    page: 'orders',
    reviewedOrderIds: ['old-order'],
  });
  const { workspaceFromState } = await import('../../src/app/workspaceSession');
  const current = createInitialState({ workspaceRevision: 2, importEpoch: 7 });
  const writes: unknown[] = [],
    session = createWorkspaceSession({
      initial: current,
      save: async (w) => {
        writes.push(w);
      },
      publish: () => undefined,
    });
  await session.restore(workspaceFromState(old));
  expect(session.getState().snapshotId).toBe(old.snapshotId);
  expect(session.getState().importEpoch).toBe(8);
  expect(session.getState().workspaceId).not.toBe(old.workspaceId);
  expect(session.getState().reviewedOrderIds).toEqual(['old-order']);
  expect(old.page).toBe('orders');
  expect(writes[0]).toMatchObject({
    previousActive: { workspaceId: current.workspaceId, revision: 2 },
  });
});
