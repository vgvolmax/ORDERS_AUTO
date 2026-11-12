import { beforeEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { baseState } from '../ui/renderWithStore';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { createWorkspaceSession, workspaceFromState, stateFromWorkspace } from '../../src/app/workspaceSession';
import { attachSupplierCatalog } from '../../src/app/catalogSession';
import { createSupplierCatalog, changeCatalogAssignment } from '../../src/domain/supplierCatalog';
import { applySharedCatalog, sharedCatalogFromLocal } from '../../src/domain/sharedSupplierCatalog';
import { derive } from '../../src/app/selectors';
import { saveWorkspace, loadActiveWorkspace, loadWorkspace } from '../../src/persistence/workspaces';
import { buildAcceptedDocuments } from '../../src/features/rebalancing/acceptedTransfersViewModel';

const first = 'ИП Баранов Роман Борисович';
const second = 'ИП Никишин Андрей Николаевич';
beforeEach(() => Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() }));

it('restores every unfinished period using current assignments and units, preserving saved physical sources', async () => {
  const old = baseState({ workspaceRevision: 0 });
  old.catalog = createSupplierCatalog(old);
  const archive = workspaceFromState(old);
  await saveWorkspace(archive, -1, [], { catalog: { expectedRevision: -1, value: old.catalog! } });
  const session = createWorkspaceSession({ initial: old, save: saveWorkspace, publish: () => undefined });
  await session.commit({ minMax: structuredClone(old.minMax) });
  await session.commit(state => ({ catalog: changeCatalogAssignment(state.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: second }) }));
  await session.restore(archive);
  expect(derive(session.getState()).projection.orders[0]!.supplier).toBe(second);
  await session.commit(state => ({ catalog: changeCatalogAssignment(state.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: first }) }));
  const otherPeriod = (await loadWorkspace(archive.workspaceId))!;
  expect(derive(attachSupplierCatalog(stateFromWorkspace(otherPeriod), session.getState().catalog)).projection.orders[0]!.supplier).toBe(first);
  expect((await loadWorkspace(archive.workspaceId))!.data.minMax).toEqual(archive.data.minMax);
});

it('uses an explicit current catalog unit over a known old report unit and invalidates reviews atomically', async () => {
  const state = baseState({ workspaceRevision: 0 });
  state.catalog = createSupplierCatalog(state);
  const ids = derive(state).projection.orders.map(order => order.id);
  state.reviewedOrderIds = ids; state.exportedOrderIds = ids;
  await saveWorkspace(workspaceFromState(state), -1, [], { catalog: { expectedRevision: -1, value: state.catalog! } });
  const session = createWorkspaceSession({ initial: state, save: saveWorkspace, publish: () => undefined });
  const document = sharedCatalogFromLocal(state.catalog!);
  document.products[0]!.unit = 'упак';
  await session.commit({ catalog: applySharedCatalog(state.catalog, document) });
  const next = session.getState();
  expect(derive(next).projection.orders[0]!.lines[0]!.unit).toBe('упак');
  expect(derive(next).quantityPolicies[0]!.unit).toBe('упак');
  expect(next.reviewedOrderIds).toEqual([]);
  expect(next.exportedOrderIds).toEqual([]);
  expect((await loadActiveWorkspace())!.data.reviewedOrderIds).toEqual([]);
});

it('freezes legacy accepted rows from historical context before applying the current catalog', () => {
  let old = rebalanceAppState();
  old.catalog = createSupplierCatalog(old);
  old.rebalance.proposal = createProposal(old);
  old = { ...old, ...prepareAcceptedChange(old, { kind: 'accept', ids: [old.rebalance.proposal.transfers[0]!.sourceLineId], expectedRevision: 0 }).patch };
  delete old.rebalance.accepted[0]!.document;
  const archived = workspaceFromState(old);
  const document = sharedCatalogFromLocal(old.catalog!);
  document.products[0]!.unit = 'упак';
  document.assignments[0]!.primary = second;
  const current = applySharedCatalog(old.catalog, document);
  const restored = attachSupplierCatalog(stateFromWorkspace(archived), current);
  const d = derive(restored);
  const docs = buildAcceptedDocuments({ accepted: restored.rebalance.accepted, registry: restored.rebalance.registry,
    skus: restored.minMax!.skus, policies: d.quantityPolicies, snapshot: d.snapshot!.snapshot });
  expect(d.projection.orders[0]!.supplier).toBe(second);
  expect(d.quantityPolicies[0]!.unit).toBe('упак');
  expect(docs[0]!.lines[0]).toMatchObject({ unit: 'шт', unitPrice: 100 });
  expect(restored.rebalance.accepted[0]!.document?.supplier).toBe(first);
});

it('does not publish a new current catalog or snapshots when the durable write fails', async () => {
  const state = baseState(); state.catalog = createSupplierCatalog(state);
  const session = createWorkspaceSession({ initial: state, save: async () => { throw Error('disk'); }, publish: () => undefined });
  await expect(session.commit({ catalog: changeCatalogAssignment(state.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: second }) })).rejects.toThrow('disk');
  expect(session.getState()).toBe(state);
  expect(derive(session.getState()).projection.orders[0]!.supplier).toBe(first);
});
