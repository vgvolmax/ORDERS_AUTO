import { createContext, useContext } from 'react';
import type {
  WorkspaceData,
  WorkspaceFile,
  StoredWorkspace,
} from '../domain/workspace';

export interface AppState extends WorkspaceData {
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

export interface Store {
  state: AppState;
  set: (patch: StatePatch) => void;
  commit?: (patch: StatePatch) => Promise<void>;
  saving?: boolean;
  restore?: (workspace: StoredWorkspace) => Promise<void>;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('StoreContext is missing');
  }
  return store;
}
