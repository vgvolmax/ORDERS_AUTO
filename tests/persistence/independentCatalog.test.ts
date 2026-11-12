import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it } from 'vitest';
import { baseState } from '../ui/renderWithStore';
import { createWorkspaceSession, stateFromWorkspace, workspaceFromState } from '../../src/app/workspaceSession';
import { saveWorkspace, loadActiveWorkspace, loadWorkspace } from '../../src/persistence/workspaces';
import { loadOrCreateSupplierCatalog, loadSupplierCatalog } from '../../src/persistence/supplierCatalog';
import { createSupplierCatalog, changeCatalogAssignment } from '../../src/domain/supplierCatalog';
import { derive } from '../../src/app/selectors';
import { db } from '../../src/persistence/db';
import { createInitialState } from '../../src/app/initialState';

const first = 'ИП Баранов Роман Борисович';
const second = 'ИП Никишин Андрей Николаевич';
const noop = () => undefined;
beforeEach(() => Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true }));

async function setup() {
  const state = baseState({ workspaceRevision: 0 });
  await saveWorkspace(workspaceFromState(state), -1);
  state.catalog = await loadOrCreateSupplierCatalog(await loadActiveWorkspace());
  return createWorkspaceSession({ initial: state, save: saveWorkspace, publish: noop });
}

it('keeps current catalog across restore and applies its links to the restored working copy and next MIN/MAX', async () => {
  const session = await setup();
  const archived = (await loadActiveWorkspace())!;
  await session.commit({ minMax: structuredClone(session.getState().minMax) });
  await session.commit((s) => ({ catalog: changeCatalogAssignment(s.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: second }) }));
  expect(derive(session.getState()).projection.orders[0]?.supplier).toBe(second);
  await session.restore(archived);
  expect(derive(session.getState()).projection.orders[0]?.supplier).toBe(second);
  expect(session.getState().catalog?.assignments[0]?.primary).toBe(second);
  expect((await loadSupplierCatalog())?.assignments[0]?.primary).toBe(second);
  expect(derive(stateFromWorkspace((await loadWorkspace(archived.workspaceId))!)).projection.orders[0]?.supplier).toBe(first);
  expect(derive(stateFromWorkspace(archived)).projection.orders[0]?.supplier).toBe(first);
  await session.commit({ minMax: structuredClone(session.getState().minMax) });
  expect(derive(session.getState()).projection.orders[0]?.supplier).toBe(second);
});

it('rolls back both records after a stale catalog revision, then accepts a fresh retry', async () => {
  const session = await setup();
  const before = session.getState();
  const stored = await loadActiveWorkspace();
  const concurrent = changeCatalogAssignment(before.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: second });
  await (await db()).put('supplierCatalog', concurrent, 'main');
  await expect(session.commit((s) => ({ catalog: changeCatalogAssignment(s.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: null }) }))).rejects.toThrow(/справочник|CATALOG/);
  expect(session.getState()).toBe(before);
  expect(await loadActiveWorkspace()).toEqual(stored);
  expect(await loadSupplierCatalog()).toEqual(concurrent);
  const fresh = createWorkspaceSession({ initial: { ...stateFromWorkspace(stored!), catalog: concurrent }, save: saveWorkspace, publish: noop });
  await fresh.commit((s) => ({ catalog: changeCatalogAssignment(s.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: null }) }));
  expect((await loadSupplierCatalog())?.assignments).toEqual([{ skuCode: 'SKU1', primary: null, additional: [first] }]);
});

it('keeps an initialized catalog even when there is no active workspace', async () => {
  const catalog = createSupplierCatalog(baseState())!;
  await (await db()).put('supplierCatalog', catalog, 'main');
  expect(await loadOrCreateSupplierCatalog(null)).toEqual(catalog);
});

it('aborts a catalog update when saving the workspace fails later in the same transaction', async () => {
  const session = await setup();
  const before = session.getState();
  const stored = await loadActiveWorkspace();
  await expect(session.commit((s) => ({
    catalog: changeCatalogAssignment(s.catalog!, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: second }),
    rawImports: { ...s.rawImports, minMax: { fileId: 'missing', name: 'missing.xlsx', size: 1, type: '', lastModified: 1 } },
  }))).rejects.toThrow('WORKSPACE_FILE_MISSING');
  expect(session.getState()).toBe(before);
  expect(await loadActiveWorkspace()).toEqual(stored);
  expect(await loadSupplierCatalog()).toEqual(before.catalog);
});

it('uses the existing catalog when restoring an unfinished startup snapshot without supplier links', async () => {
  const session = await setup();
  const catalog = session.getState().catalog;
  const unfinished = createInitialState({ minMax: baseState().minMax, workspaceRevision: 0 });
  await session.restore(workspaceFromState(unfinished));
  expect(session.getState().catalog).toBe(catalog);
  expect(session.getState().supplierAssignments).toEqual(catalog?.assignments);
  expect(session.getState().suppliers).toEqual(catalog?.source?.data);
  expect((await loadSupplierCatalog())?.revision).toBe(catalog?.revision);
});

it('initializes a missing catalog atomically when recovering a complete legacy snapshot', async () => {
  const session = createWorkspaceSession({ initial: createInitialState(), save: saveWorkspace, publish: noop });
  await session.restore(workspaceFromState(baseState({ workspaceRevision: 0 })));
  expect((await loadSupplierCatalog())?.assignments[0]?.primary).toBe(first);
  expect(session.getState().catalog).toEqual(await loadSupplierCatalog());
});
