import { createContext, useContext } from 'react';
import type { WorkspaceData, WorkspaceFile } from '../domain/workspace';

export interface AppState extends WorkspaceData {
  workspaceId: string; workspaceRevision: number; snapshotId: string; workspaceCreatedAt: string;
  toast: string | null; minMaxLoading: boolean; supplierLoading: boolean;
  pendingFiles?: WorkspaceFile[]; storageError?: string | null;
}
export type StatePatch = Partial<AppState> | ((current: AppState) => Partial<AppState>);

export interface Store {
  state: AppState;
  set: (patch: StatePatch) => void;
  commit?: (patch: StatePatch) => Promise<void>;
  saving?: boolean;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('StoreContext is missing');
  }
  return store;
}
