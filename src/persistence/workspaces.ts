import { db, type WorkspaceRecord, type WorkspaceSources } from './db';
import type { SupplierCatalog } from '../domain/supplierCatalog';
import { applyWorkspaceView, workspaceView, type WorkspaceView } from '../domain/workspace';
import type {
  ActiveWorkspace,
  StoredWorkspace,
  WorkspaceFile,
  WorkspaceMetadata,
} from '../domain/workspace';
function checked(value: StoredWorkspace | undefined): StoredWorkspace | null {
  if (!value) return null;
  if (value.schemaVersion !== 1)
    throw new Error(
      'WORKSPACE_VERSION: версия сохранённого сеанса не поддерживается',
    );
  if (
    !value.data ||
    !value.workspaceId ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error(
      'WORKSPACE_CORRUPT: не удалось прочитать сохранённый сеанс',
    );
  return value;
}
function hydrate(
  { separatedSources, ...record }: WorkspaceRecord,
  sources: WorkspaceSources | undefined,
  view: WorkspaceView | undefined,
): StoredWorkspace {
  if (separatedSources && !sources)
    throw new Error('WORKSPACE_CORRUPT: отчёты сохранённого сеанса не найдены');
  const data = { ...record.data, ...sources };
  return { ...record, data: view ? applyWorkspaceView(data, view) : data };
}

export async function loadWorkspace(id: string): Promise<StoredWorkspace | null> {
  const tx = (await db()).transaction(['workspaces', 'workspaceSources', 'workspaceViews']);
  const [record, sources, view] = await Promise.all([
    tx.objectStore('workspaces').get(id),
    tx.objectStore('workspaceSources').get(id),
    tx.objectStore('workspaceViews').get(id),
  ]);
  await tx.done;
  return record && checked(record) ? hydrate(record, sources, view) : null;
}

export async function loadActiveWorkspace(): Promise<StoredWorkspace | null> {
  const tx = (await db()).transaction(['workspaceMeta', 'workspaces', 'workspaceSources', 'workspaceViews']);
  const active = await tx.objectStore('workspaceMeta').get('main');
  if (!active) {
    await tx.done;
    return null;
  }
  const [record, sources, view] = await Promise.all([
    tx.objectStore('workspaces').get(active.workspaceId),
    tx.objectStore('workspaceSources').get(active.workspaceId),
    tx.objectStore('workspaceViews').get(active.workspaceId),
  ]);
  await tx.done;
  if (!record || !checked(record) || record.revision !== active.revision)
    throw new Error('WORKSPACE_CORRUPT: активная версия сеанса не найдена');
  return hydrate(record, sources, view);
}

function mergeViewChanges<T extends object>(stored: T, previous: T, next: T): T {
  const merged = { ...stored };
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)] as (keyof T)[]);
  for (const key of keys) {
    if (Object.is(previous[key], next[key]) && Object.hasOwn(previous, key) === Object.hasOwn(next, key)) continue;
    if (Object.hasOwn(next, key)) merged[key] = next[key];
    else Reflect.deleteProperty(merged, key);
  }
  return merged;
}

function mergeWorkspaceView(stored: WorkspaceView, previous: WorkspaceView, next: WorkspaceView): WorkspaceView {
  const rebalance = mergeViewChanges(stored.rebalance, previous.rebalance, next.rebalance);
  if (stored.rebalance.resultScope && previous.rebalance.resultScope && next.rebalance.resultScope) {
    rebalance.resultScope = mergeViewChanges(
      stored.rebalance.resultScope, previous.rebalance.resultScope, next.rebalance.resultScope,
    );
  }
  if (stored.rebalance.acceptedFilters && previous.rebalance.acceptedFilters && next.rebalance.acceptedFilters) {
    rebalance.acceptedFilters = mergeViewChanges(
      stored.rebalance.acceptedFilters, previous.rebalance.acceptedFilters, next.rebalance.acceptedFilters,
    );
  }
  return {
    page: previous.page === next.page ? stored.page : next.page,
    uiPreferences: mergeViewChanges(stored.uiPreferences, previous.uiPreferences, next.uiPreferences),
    rebalance,
  };
}

function workspaceConflict(): Error {
  return new Error(
    'WORKSPACE_CONFLICT: сеанс изменён в другой вкладке; откройте актуальную сохранённую версию',
  );
}

export async function saveWorkspaceView(id: string, previous: WorkspaceView, next: WorkspaceView): Promise<void> {
  const tx = (await db()).transaction(['workspaceMeta', 'workspaces', 'workspaceViews'], 'readwrite');
  void tx.done.catch(() => undefined);
  const active = await tx.objectStore('workspaceMeta').get('main');
  if (active?.workspaceId !== id) throw workspaceConflict();
  const views = tx.objectStore('workspaceViews');
  const stored = await views.get(id);
  const record = stored ? undefined : await tx.objectStore('workspaces').get(id);
  const view = stored ?? (record ? workspaceView(record.data) : previous);
  await views.put(mergeWorkspaceView(view, previous, next), id);
  await tx.done;
}
export async function readActiveWorkspaceRevision(): Promise<ActiveWorkspace | null> {
  return (await (await db()).get('workspaceMeta', 'main')) ?? null;
}
export async function loadWorkspaceFile(
  id: string,
): Promise<WorkspaceFile | null> {
  return (await (await db()).get('workspaceFiles', id)) ?? null;
}
export async function listWorkspaces(): Promise<WorkspaceMetadata[]> {
  return (await (await db()).getAll('workspaces'))
    .map((w) => {
      checked(w);
      return {
        workspaceId: w.workspaceId,
        revision: w.revision,
        snapshotId: w.snapshotId,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        minMaxFileName: w.data.minMaxFileName,
        supplierFileName: w.data.supplierFileName,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export interface WorkspaceSaveOptions {
  catalog?: { expectedRevision: number; value: SupplierCatalog };
  reuseSources?: boolean;
  updateView?: boolean;
  previousView?: WorkspaceView;
}

export async function saveWorkspace(
  value: StoredWorkspace,
  expectedRevision: number,
  files: WorkspaceFile[] = [],
  options?: WorkspaceSaveOptions,
): Promise<void> {
  checked(value);
  if (value.revision !== expectedRevision + 1)
    throw new Error('WORKSPACE_CONFLICT');
  const tx = (await db()).transaction(
    ['workspaces', 'workspaceFiles', 'workspaceMeta', 'workspaceSources', 'workspaceViews', 'supplierCatalog'],
    'readwrite',
  );
  void tx.done.catch(() => undefined);
  try {
    const stored = await tx.objectStore('workspaces').get(value.workspaceId),
      active = await tx.objectStore('workspaceMeta').get('main');
    const expectedActive =
      expectedRevision === -1
        ? value.previousActive
        : { workspaceId: value.workspaceId, revision: expectedRevision };
    if (
      (stored?.revision ?? -1) !== expectedRevision ||
      (active?.workspaceId ?? null) !== (expectedActive?.workspaceId ?? null) ||
      (active?.revision ?? -1) !== (expectedActive?.revision ?? -1)
    )
      throw workspaceConflict();
    if (options?.catalog) {
      const catalogs = tx.objectStore('supplierCatalog');
      const current = await catalogs.get('main');
      if ((current?.revision ?? -1) !== options.catalog.expectedRevision)
        throw new Error('CATALOG_CONFLICT: справочник изменён в другой вкладке. Обновите страницу и повторите действие.');
      await catalogs.put(options.catalog.value, 'main');
    }
    const rawFiles = tx.objectStore('workspaceFiles');
    for (const file of files) {
      if ((await rawFiles.getKey(file.fileId)) !== undefined)
        throw new Error('WORKSPACE_FILE_EXISTS');
      await rawFiles.put(file);
    }
    for (const ref of Object.values(value.data.rawImports))
      if (ref && (await rawFiles.getKey(ref.fileId)) === undefined)
        throw new Error('WORKSPACE_FILE_MISSING');
    const { minMax, suppliers, minMaxIssues, supplierIssues, ...workingData } = value.data;
    if (!options?.reuseSources || !stored?.separatedSources) {
      await tx.objectStore('workspaceSources').put(
        { minMax, suppliers, minMaxIssues, supplierIssues }, value.workspaceId,
      );
    }
    if (!options || options.updateView) {
      const views = tx.objectStore('workspaceViews');
      const nextView = workspaceView(value.data);
      const view = options?.previousView && stored
        ? mergeWorkspaceView(
            (await views.get(value.workspaceId)) ?? workspaceView(stored.data),
            options.previousView,
            nextView,
          )
        : nextView;
      await views.put(view, value.workspaceId);
    }
    await tx.objectStore('workspaces').put({
      ...value,
      separatedSources: true,
      data: { ...workingData, minMax: null, suppliers: null, minMaxIssues: [], supplierIssues: [] },
    });
    await tx
      .objectStore('workspaceMeta')
      .put(
        { workspaceId: value.workspaceId, revision: value.revision },
        'main',
      );
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* transaction already aborted */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
