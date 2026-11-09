import {
  derive,
  reconcileOrderQtyEdits,
  reusePurchasingProjection,
} from './selectors';
import { changedOrderIds } from '../domain/rebalanceWorkflow';
import { seedSupplierAssignments } from '../domain/supplierAssignments';
import type { AppState, StatePatch } from './appStore';
import type { StoredWorkspace, WorkspaceFile } from '../domain/workspace';
import { createInitialState, reconcileRegistry } from './initialState';
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
export function createWorkspaceSession({
  initial,
  save,
  publish,
  id = () => crypto.randomUUID(),
}: {
  initial: AppState;
  save: (
    w: StoredWorkspace,
    expected: number,
    files?: WorkspaceFile[],
  ) => Promise<void>;
  publish: (state: AppState) => void;
  id?: () => string;
}) {
  let state = initial,
    tail = Promise.resolve();
  return {
    getState: () => state,
    restore(workspace: StoredWorkspace): Promise<void> {
      const operation = tail.then(async () => {
        const next = createInitialState({
          ...workspace.data,
          importEpoch: state.importEpoch + 1,
          workspaceId: id(),
          snapshotId: workspace.snapshotId,
          workspaceRevision: 0,
          workspaceCreatedAt: new Date().toISOString(),
        });
        const stored = workspaceFromState(next);
        if (state.workspaceRevision >= 0)
          stored.previousActive = {
            workspaceId: state.workspaceId,
            revision: state.workspaceRevision,
          };
        await save(stored, -1);
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
        let next = {
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
          (minMaxChanged || next.suppliers !== previous.suppliers)
        )
          next.supplierAssignments = seedSupplierAssignments(
            next.suppliers.history,
          );
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
            previous.supplierAssignments !== next.supplierAssignments)
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
