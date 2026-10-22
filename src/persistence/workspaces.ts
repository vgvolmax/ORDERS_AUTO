import { db } from './db';
import type {
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
export async function loadWorkspace(
  id: string,
): Promise<StoredWorkspace | null> {
  return checked(await (await db()).get('workspaces', id));
}
export async function loadActiveWorkspace(): Promise<StoredWorkspace | null> {
  const tx = (await db()).transaction(['workspaceMeta', 'workspaces']);
  const active = await tx.objectStore('workspaceMeta').get('main');
  const value = active
    ? checked(await tx.objectStore('workspaces').get(active.workspaceId))
    : null;
  await tx.done;
  if (active && (!value || value.revision !== active.revision))
    throw new Error('WORKSPACE_CORRUPT: активная версия сеанса не найдена');
  return value;
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
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveWorkspace(
  value: StoredWorkspace,
  expectedRevision: number,
  files: WorkspaceFile[] = [],
): Promise<void> {
  checked(value);
  if (value.revision !== expectedRevision + 1)
    throw new Error('WORKSPACE_CONFLICT');
  const tx = (await db()).transaction(
    ['workspaces', 'workspaceFiles', 'workspaceMeta'],
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
      throw new Error(
        'WORKSPACE_CONFLICT: сеанс изменён в другой вкладке; откройте актуальную сохранённую версию',
      );
    for (const file of files) {
      if (await tx.objectStore('workspaceFiles').get(file.fileId))
        throw new Error('WORKSPACE_FILE_EXISTS');
      await tx.objectStore('workspaceFiles').put(file);
    }
    for (const ref of Object.values(value.data.rawImports))
      if (ref && !(await tx.objectStore('workspaceFiles').get(ref.fileId)))
        throw new Error('WORKSPACE_FILE_MISSING');
    await tx.objectStore('workspaces').put(value);
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
