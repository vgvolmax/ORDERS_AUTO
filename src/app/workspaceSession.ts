import {
  derive,
  reconcileOrderQtyEdits,
  reusePurchasingProjection,
} from './selectors';
import { changedOrderIds } from '../domain/rebalanceWorkflow';
import { seedSupplierAssignments } from '../domain/supplierAssignments';
import type { AppState, StatePatch } from './appStore';
import {
  applyWorkspaceView,
  rebalanceViewKeys,
  workspaceView,
  type StoredWorkspace,
  type WorkspaceFile,
  type WorkspaceView,
  type WorkspaceData,
} from '../domain/workspace';
import type { WorkspaceSaveOptions } from '../persistence/workspaces';
import { createInitialState, reconcileRegistry } from './initialState';
import { attachSupplierCatalog, prepareCatalogState } from './catalogSession';
import { createSupplierCatalog, type SupplierCatalog } from '../domain/supplierCatalog';
import { snapshotSupplierContext } from '../domain/supplierContext';
export function workspaceFromState(state: AppState): StoredWorkspace {
  const {
    minMax,
    suppliers,
    minMaxFileName,
    supplierFileName,
    minMaxIssues,
    supplierIssues,
    supplierAssignments,
    edits,
    settings,
    reviewedOrderIds,
    exportedOrderIds,
    page,
    rebalance,
    uiPreferences,
    rawImports,
  } = state;
  return {
    schemaVersion: 1,
    workspaceId: state.workspaceId,
    revision: state.workspaceRevision,
    snapshotId: state.snapshotId,
    createdAt: state.workspaceCreatedAt,
    updatedAt: new Date().toISOString(),
    data: {
      minMax,
      suppliers,
      minMaxFileName,
      supplierFileName,
      minMaxIssues,
      supplierIssues,
      ...(supplierAssignments === undefined ? {} : { supplierAssignments }),
      ...(state.supplierContext || state.catalog ? {
        supplierContext: state.supplierContext ?? snapshotSupplierContext(state.catalog!),
      } : {}),
      edits,
      settings,
      reviewedOrderIds,
      exportedOrderIds,
      page,
      rebalance,
      uiPreferences,
      rawImports,
    },
  };
}
export function stateFromWorkspace(w: StoredWorkspace): AppState {
  return createInitialState({
    ...w.data,
    workspaceId: w.workspaceId,
    workspaceRevision: w.revision,
    snapshotId: w.snapshotId,
    workspaceCreatedAt: w.createdAt,
  });
}
function sameRebalanceData(previous: AppState, next: AppState): boolean {
  return Object.entries(next.rebalance).every(([key, value]) =>
    rebalanceViewKeys.some((viewKey) => viewKey === key) ||
    previous.rebalance[key as keyof AppState['rebalance']] === value,
  );
}

function hasViewChanges(previous: AppState, next: AppState): boolean {
  return next.page !== previous.page || next.uiPreferences !== previous.uiPreferences ||
    rebalanceViewKeys.some((key) => next.rebalance[key] !== previous.rebalance[key]);
}

export function createWorkspaceSession({
  initial,
  save,
  saveView,
  recoverCatalog = async (data) => createSupplierCatalog(data),
  publish,
  id = () => crypto.randomUUID(),
}: {
  initial: AppState;
  save: (
    w: StoredWorkspace,
    expected: number,
    files?: WorkspaceFile[],
    options?: WorkspaceSaveOptions,
  ) => Promise<void>;
  saveView?: (id: string, previous: WorkspaceView, next: WorkspaceView) => Promise<void>;
  recoverCatalog?: (data: WorkspaceData) => Promise<SupplierCatalog | null>;
  publish: (state: AppState) => void;
  id?: () => string;
}) {
  let state = initial,
    tail = Promise.resolve();
  return {
    getState: () => state,
    restore(workspace: StoredWorkspace): Promise<void> {
      const operation = tail.then(async () => {
        const next = attachSupplierCatalog(createInitialState({
          ...workspace.data,
          importEpoch: state.importEpoch + 1,
          workspaceId: id(),
          snapshotId: workspace.snapshotId,
          workspaceRevision: 0,
          workspaceCreatedAt: new Date().toISOString(),
        }), state.catalog ?? await recoverCatalog(workspace.data));
        const stored = workspaceFromState(next);
        if (state.workspaceRevision >= 0)
          stored.previousActive = {
            workspaceId: state.workspaceId,
            revision: state.workspaceRevision,
          };
        await save(stored, -1, [], next.catalog && next.catalog !== state.catalog ? {
          catalog: { expectedRevision: state.catalog?.revision ?? -1, value: next.catalog },
        } : undefined);
        state = next;
        publish(next);
      });
      tail = operation.catch(() => undefined);
      return operation;
    },
    transient(patch: Partial<AppState>) {
      const next = { ...state, ...patch };
      reusePurchasingProjection(state, next);
      state = next;
      publish(next);
    },
    commit(patch: StatePatch): Promise<void> {
      const operation = tail.then(async () => {
        const update = typeof patch === 'function' ? patch(state) : patch;
        if (!Object.keys(update).length) return;
        const previous = state;
        if (
          previous.supplierAssignments !== undefined &&
          update.suppliers !== undefined
        ) {
          return;
        }
        let next: AppState = {
          ...state,
          ...update,
          workspaceRevision: state.workspaceRevision + 1,
        };
        const minMaxChanged = next.minMax !== previous.minMax;
        const replaced =
          minMaxChanged &&
          previous.minMax !== null &&
          previous.supplierAssignments !== undefined;
        if (
          next.supplierAssignments === undefined &&
          next.minMax &&
          next.suppliers &&
          (minMaxChanged ||
            next.suppliers !== previous.suppliers ||
            update.page === 'all')
        )
          next.supplierAssignments = seedSupplierAssignments(
            next.suppliers.history,
          );
        next = prepareCatalogState(previous, next);
        if (!previous.catalog && next.catalog && !update.catalog) {
          next.catalog = await recoverCatalog(next);
          if (!next.catalog) throw new Error('CATALOG_INITIALIZATION: не удалось подготовить справочник');
        }
        if (next.catalog && (next.catalog !== previous.catalog || minMaxChanged)) {
          next = { ...next, supplierContext: snapshotSupplierContext(next.catalog) };
        }
        const viewChanged = hasViewChanges(previous, next);
        if (
          saveView &&
          next.catalog === previous.catalog &&
          next.supplierAssignments === previous.supplierAssignments &&
          Object.keys(update).every((key) =>
            key === 'page' || key === 'uiPreferences' || key === 'rebalance' || key === 'toast',
          ) &&
          sameRebalanceData(previous, next)
        ) {
          const view = workspaceView(next);
          if (viewChanged && previous.workspaceRevision >= 0)
            await saveView(previous.workspaceId, workspaceView(previous), view);
          const published = {
            ...applyWorkspaceView(state, view),
            toast: update.toast === undefined ? state.toast : update.toast,
          };
          reusePurchasingProjection(state, published);
          state = published;
          publish(published);
          return;
        }
        if (minMaxChanged)
          next.rebalance = {
            ...next.rebalance,
            registry: reconcileRegistry(
              next.rebalance.registry,
              next.minMax?.branches ?? [],
              id,
            ),
          };
        if (replaced)
          next = {
            ...next,
            workspaceId: id(),
            snapshotId: id(),
            workspaceRevision: 0,
            workspaceCreatedAt: new Date().toISOString(),
            edits: [],
            reviewedOrderIds: [],
            exportedOrderIds: [],
            rebalance: {
              ...next.rebalance,
              accepted: [],
              acceptedRevision: 0,
              proposal: null,
              selectedLineIds: [],
              rejectedLineIds: [],
            },
          };
        if (
          !minMaxChanged &&
          (previous.edits !== next.edits ||
            previous.settings !== next.settings ||
            previous.supplierAssignments !== next.supplierAssignments ||
            previous.supplierContext !== next.supplierContext ||
            previous.catalog !== next.catalog)
        ) {
          const scoped = previous.edits !== next.edits
            ? reconcileOrderQtyEdits(previous, next)
            : null;
          if (scoped) {
            next = scoped;
          } else {
            const before = derive(previous);
            const after = derive(next);
            const affected = changedOrderIds(
              before.projection.orders,
              after.projection.orders,
            );
            if (affected.size) {
              const reconciled = {
                ...next,
                reviewedOrderIds: next.reviewedOrderIds.filter(
                  (id) => !affected.has(id),
                ),
                exportedOrderIds: next.exportedOrderIds.filter(
                  (id) => !affected.has(id),
                ),
              };
              reusePurchasingProjection(next, reconciled);
              next = reconciled;
            }
          }
        }
        reusePurchasingProjection(previous, next);
        const stored = workspaceFromState(next);
        if (replaced && previous.workspaceRevision >= 0)
          stored.previousActive = {
            workspaceId: previous.workspaceId,
            revision: previous.workspaceRevision,
          };
        await save(
          stored,
          replaced ? -1 : previous.workspaceRevision,
          update.pendingFiles ?? [],
          {
            ...(next.catalog && next.catalog !== previous.catalog ? {
              catalog: { expectedRevision: previous.catalog?.revision ?? -1, value: next.catalog },
            } : {}),
            reuseSources: !replaced && !minMaxChanged && next.suppliers === previous.suppliers &&
              next.minMaxIssues === previous.minMaxIssues && next.supplierIssues === previous.supplierIssues,
            updateView: viewChanged || replaced || previous.workspaceRevision < 0,
            ...(viewChanged && !replaced && previous.workspaceRevision >= 0
              ? { previousView: workspaceView(previous) }
              : {}),
          },
        );
        const published = {
          ...next,
          pendingFiles: [],
          storageError: null,
          page: update.page ?? state.page,
          toast: update.toast === undefined ? state.toast : update.toast,
          minMaxLoading: update.minMaxLoading ?? state.minMaxLoading,
          supplierLoading: update.supplierLoading ?? state.supplierLoading,
        };
        reusePurchasingProjection(next, published);
        state = published;
        publish(published);
      });
      tail = operation.catch(() => undefined);
      return operation;
    },
  };
}
