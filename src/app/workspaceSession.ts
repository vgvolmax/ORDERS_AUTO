import { derive } from './selectors';
import { buildAcceptedTransferStatePatch } from '../domain/rebalanceWorkflow';
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
    overrides,
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
      overrides,
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
      state = { ...state, ...patch };
      publish(state);
    },
    commit(patch: StatePatch): Promise<void> {
      const operation = tail.then(async () => {
        const update = typeof patch === 'function' ? patch(state) : patch;
        if (!Object.keys(update).length) return;
        const previous = state;
        let next = {
          ...state,
          ...update,
          workspaceRevision: state.workspaceRevision + 1,
        };
        const replaced =
          (update.minMax !== undefined && update.minMax !== state.minMax) ||
          (update.suppliers !== undefined &&
            update.suppliers !== state.suppliers);
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
              registry: reconcileRegistry(
                next.rebalance.registry,
                next.minMax?.branches ?? [],
                id,
              ),
              accepted: [],
              acceptedRevision: 0,
              proposal: null,
              selectedLineIds: [],
              rejectedLineIds: [],
            },
          };
        if (
          !replaced &&
          (update.edits || update.overrides || update.settings)
        ) {
          const before = derive(previous),
            after = derive(next);
          const workflow = buildAcceptedTransferStatePatch({
            previousDemand: before.purchaseDemand,
            nextDemand: after.purchaseDemand,
            previousProjection: before.projection,
            resolutions: after.resolutions,
            settings: next.settings,
            edits: next.edits,
            reviewedOrderIds: next.reviewedOrderIds,
            exportedOrderIds: next.exportedOrderIds,
          });
          next = {
            ...next,
            edits: workflow.edits,
            reviewedOrderIds: workflow.reviewedOrderIds,
            exportedOrderIds: workflow.exportedOrderIds,
          };
        }
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
        next = {
          ...next,
          pendingFiles: [],
          storageError: null,
          toast: update.toast === undefined ? state.toast : update.toast,
          minMaxLoading: update.minMaxLoading ?? state.minMaxLoading,
          supplierLoading: update.supplierLoading ?? state.supplierLoading,
        };
        state = next;
        publish(next);
      });
      tail = operation.catch(() => undefined);
      return operation;
    },
  };
}
