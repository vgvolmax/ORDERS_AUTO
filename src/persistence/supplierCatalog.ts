import { createSupplierCatalog, type SupplierCatalog } from '../domain/supplierCatalog';
import type { StoredWorkspace } from '../domain/workspace';
import { db } from './db';
import { listWorkspaces, loadWorkspace } from './workspaces';

export function checkedSupplierCatalog(catalog: SupplierCatalog | undefined): SupplierCatalog | null {
  if (!catalog) return null;
  if (catalog.schemaVersion !== 1 || !Number.isSafeInteger(catalog.revision) || catalog.revision < 0 ||
      !Array.isArray(catalog.products) || !Array.isArray(catalog.assignments)) {
    throw new Error('CATALOG_CORRUPT: не удалось прочитать справочник товаров и поставщиков');
  }
  return catalog;
}

export async function loadSupplierCatalog(): Promise<SupplierCatalog | null> {
  return checkedSupplierCatalog(await (await db()).get('supplierCatalog', 'main'));
}

/** Idempotent migration: never merge historic supplier choices into the catalog. */
export async function loadOrCreateSupplierCatalog(active: StoredWorkspace | null): Promise<SupplierCatalog | null> {
  const existing = await loadSupplierCatalog();
  if (existing || active?.data.supplierAssignments === undefined) return existing;
  const history: StoredWorkspace['data'][] = [];
  for (const meta of await listWorkspaces()) {
    if (meta.workspaceId === active.workspaceId) continue;
    const workspace = await loadWorkspace(meta.workspaceId);
    if (workspace) history.push(workspace.data);
  }
  const catalog = createSupplierCatalog(active.data, history)!;
  const tx = (await db()).transaction(['supplierCatalog', 'workspaceMeta'], 'readwrite');
  void tx.done.catch(() => undefined);
  try {
    const current = checkedSupplierCatalog(await tx.objectStore('supplierCatalog').get('main'));
    const owner = await tx.objectStore('workspaceMeta').get('main');
    if (owner?.workspaceId !== active.workspaceId || owner.revision !== active.revision) {
      throw new Error('CATALOG_CONFLICT: сеанс изменился при переносе справочника. Повторите открытие.');
    }
    if (!current) await tx.objectStore('supplierCatalog').put(catalog, 'main');
    await tx.done;
    return current ?? catalog;
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
