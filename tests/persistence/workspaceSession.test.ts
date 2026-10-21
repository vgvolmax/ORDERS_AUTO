import { describe, expect, it } from 'vitest';
import { baseState } from '../ui/renderWithStore';
import { derive } from '../../src/app/selectors';
import { createInitialState } from '../../src/app/initialState';
import { createWorkspaceSession } from '../../src/app/workspaceSession';

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
  const current = createInitialState({ workspaceRevision: 2 });
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
  expect(session.getState().workspaceId).not.toBe(old.workspaceId);
  expect(session.getState().reviewedOrderIds).toEqual(['old-order']);
  expect(old.page).toBe('orders');
  expect(writes[0]).toMatchObject({
    previousActive: { workspaceId: current.workspaceId, revision: 2 },
  });
});
