import { createContext, useContext } from 'react';
import type { SharedSupplierCatalog } from '../domain/sharedSupplierCatalog';
import type { SupplierCatalog } from '../domain/supplierCatalog';
import type {
  WorkspaceData,
  WorkspaceFile,
  StoredWorkspace,
} from '../domain/workspace';

export interface AppState extends WorkspaceData {
  catalog: SupplierCatalog | null;
  workspaceId: string;
  workspaceRevision: number;
  snapshotId: string;
  workspaceCreatedAt: string;
  importEpoch: number;
  toast: string | null;
  minMaxLoading: boolean;
  supplierLoading: boolean;
  pendingFiles?: WorkspaceFile[];
  storageError?: string | null;
}
export type StatePatch =
  | Partial<AppState>
  | ((current: AppState) => Partial<AppState>);

export type WorkspaceRebaseCheck = (before: AppState, latest: AppState) => void;

export interface Store {
  state: AppState;
  set: (patch: StatePatch) => void;
  commit?: (patch: StatePatch, rebase?: WorkspaceRebaseCheck) => Promise<void>;
  saving?: boolean;
  restore?: (workspace: StoredWorkspace) => Promise<void>;
  shared?: {
    team: string | null;
    editable: boolean;
    catalogReadOnly: boolean;
    sourceConnected: boolean;
    sourceUnavailable: boolean;
    updateCatalog: (catalog: SharedSupplierCatalog) => Promise<void>;
    openReport?: (patch: Partial<AppState>, file: WorkspaceFile) => Promise<void>;
  };
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('StoreContext is missing');
  }
  return store;
}
