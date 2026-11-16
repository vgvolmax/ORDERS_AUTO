import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it } from 'vitest';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { createWorkspaceSession, workspaceFromState } from '../../src/app/workspaceSession';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { sharedCatalogFromLocal } from '../../src/domain/sharedSupplierCatalog';
import { saveWorkspace, loadActiveWorkspace } from '../../src/persistence/workspaces';
import { loadSupplierCatalog } from '../../src/persistence/supplierCatalog';

beforeEach(() => Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true }));

it('excludes disappeared codes from all working calculations and reuses their links on return and restore', async () => {
  let initial = rebalanceAppState();
  initial.catalog = createSupplierCatalog(initial);
  initial.rebalance.proposal = createProposal(initial);
  initial = { ...initial, ...prepareAcceptedChange(initial, { kind: 'accept', ids: [initial.rebalance.proposal.transfers[0]!.sourceLineId], expectedRevision: 0 }).patch };
  initial.workspaceRevision = 0;
  await saveWorkspace(workspaceFromState(initial), -1, [], { catalog: { expectedRevision: -1, value: initial.catalog! } });
  const archived = (await loadActiveWorkspace())!;
  const accepted = structuredClone(initial.rebalance.accepted);
  const session = createWorkspaceSession({ initial, save: saveWorkspace, publish: () => undefined });
  const next = structuredClone(initial.minMax!);
  // Repeated article deliberately does not make the new Code 1C the old product.
  next.skus[0] = { ...next.skus[0]!, code: '000123', name: 'Другой код того же артикула' };
  next.branchStocks.forEach(row => { row.skuCode = '000123'; });
  await session.commit({ minMax: next });
  const current = session.getState();
  const d = derive(current);
  expect(current.catalog!.products.map(p => p.code)).toEqual(['SKU1', '000123']);
  expect(current.catalog!.assignments.find(a => a.skuCode === 'SKU1')?.primary).toBe('ИП Баранов Роман Борисович');
  expect(d.demand.map(row => row.skuCode)).toEqual(['000123', '000123', '000123']);
  expect(d.purchaseDemand.every(row => row.skuCode !== 'SKU1')).toBe(true);
  expect(d.projection.orders.flatMap(o => o.lines).some(row => row.skuCode === 'SKU1')).toBe(false);
  expect(d.resolutions.map(r => r.skuCode)).toEqual(['000123']);
  expect(d.quantityPolicies.map(p => p.skuCode)).toEqual(['000123']);
  expect(d.snapshot!.snapshot.skus.map(s => s.skuCode)).toEqual(['000123']);
  expect(createProposal(current).transfers.map(t => t.skuCode)).toEqual(['000123', '000123']);
  expect((await loadSupplierCatalog())!.products).toEqual(current.catalog!.products);
  expect(Object.keys(sharedCatalogFromLocal(current.catalog!))).toEqual(['kind', 'schemaVersion', 'suppliers', 'products', 'assignments']);
  expect(sharedCatalogFromLocal(current.catalog!).products.every(p => !Object.hasOwn(p, 'active'))).toBe(true);

  await session.restore(archived);
  expect(session.getState().minMax!.skus.map(s => s.code)).toEqual(['SKU1']);
  expect(session.getState().rebalance.accepted).toEqual(accepted);
  expect(derive(session.getState()).projection.orders.every(o => o.supplier === 'ИП Баранов Роман Борисович')).toBe(true);
  expect(session.getState().catalog!.products).toHaveLength(2);
  await session.commit({ minMax: structuredClone(initial.minMax!) });
  expect(derive(session.getState()).resolutions[0]!.selectedSupplier).toBe('ИП Баранов Роман Борисович');
  expect(derive(session.getState()).quantityPolicies[0]!.unit).toBe('шт');
});

it('keeps the previous report and catalog if saving the next MIN/MAX fails', async () => {
  const initial = rebalanceAppState();
  initial.catalog = createSupplierCatalog(initial);
  const session = createWorkspaceSession({ initial, publish: () => undefined, save: async () => { throw new Error('TEST_WRITE_FAILURE'); } });
  const next = structuredClone(initial.minMax!);
  next.skus = [];
  next.branchStocks = [];
  await expect(session.commit({ minMax: next })).rejects.toThrow('TEST_WRITE_FAILURE');
  expect(session.getState()).toBe(initial);
  expect(session.getState().minMax!.skus[0]!.code).toBe('SKU1');
  expect(session.getState().catalog!.assignments[0]!.primary).toBe('ИП Баранов Роман Борисович');
});
