import { openDB, type DBSchema } from 'idb';
import type { OrderSettings, SupplierOverride } from '../domain/types';
import type {
  StoredWorkspace,
  WorkspaceFile,
  ActiveWorkspace,
  WorkspaceData,
  WorkspaceView,
} from '../domain/workspace';

export type WorkspaceSources = Pick<WorkspaceData,
  'minMax' | 'suppliers' | 'minMaxIssues' | 'supplierIssues'>;
export type WorkspaceRecord = StoredWorkspace & { separatedSources?: true };

interface OrdersAutoSchema extends DBSchema {
  workspaces: {
    key: string;
    value: WorkspaceRecord;
    indexes: Record<string, never>;
  };
  workspaceSources: { key: string; value: WorkspaceSources; };
  workspaceViews: { key: string; value: WorkspaceView; };
  workspaceFiles: {
    key: string;
    value: WorkspaceFile;
    indexes: Record<string, never>;
  };
  workspaceMeta: {
    key: string;
    value: ActiveWorkspace;
    indexes: Record<string, never>;
  };
  supplierOverrides: {
    key: string;
    value: SupplierOverride;
    indexes: Record<string, never>;
  };
  settings: {
    key: string;
    value: OrderSettings;
    indexes: Record<string, never>;
  };
}

export function db() {
  return openDB<OrdersAutoSchema>('orders-auto', 3, {
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
    },
    upgrade(database) {
      if (!database.objectStoreNames.contains('workspaces'))
        database.createObjectStore('workspaces', { keyPath: 'workspaceId' });
      if (!database.objectStoreNames.contains('workspaceSources'))
        database.createObjectStore('workspaceSources');
      if (!database.objectStoreNames.contains('workspaceViews'))
        database.createObjectStore('workspaceViews');
      if (!database.objectStoreNames.contains('workspaceFiles'))
        database.createObjectStore('workspaceFiles', { keyPath: 'fileId' });
      if (!database.objectStoreNames.contains('workspaceMeta'))
        database.createObjectStore('workspaceMeta');
      if (!database.objectStoreNames.contains('supplierOverrides')) {
        database.createObjectStore('supplierOverrides', { keyPath: 'skuCode' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings');
      }
    },
  });
}
