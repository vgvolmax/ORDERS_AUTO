import { openDB, type DBSchema } from 'idb';
import type { OrderSettings, SupplierOverride } from '../domain/types';
import type { StoredWorkspace, WorkspaceFile, ActiveWorkspace } from '../domain/workspace';

interface OrdersAutoSchema extends DBSchema {
  workspaces: { key: string; value: StoredWorkspace; indexes: Record<string, never> };
  workspaceFiles: { key: string; value: WorkspaceFile; indexes: Record<string, never> };
  workspaceMeta: { key: string; value: ActiveWorkspace; indexes: Record<string, never> };
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
  return openDB<OrdersAutoSchema>('orders-auto', 2, {
    blocking(_current, _next, event) { (event.target as IDBDatabase).close(); },
    upgrade(database) {
      if (!database.objectStoreNames.contains('workspaces')) database.createObjectStore('workspaces', { keyPath: 'workspaceId' });
      if (!database.objectStoreNames.contains('workspaceFiles')) database.createObjectStore('workspaceFiles', { keyPath: 'fileId' });
      if (!database.objectStoreNames.contains('workspaceMeta')) database.createObjectStore('workspaceMeta');
      if (!database.objectStoreNames.contains('supplierOverrides')) {
        database.createObjectStore('supplierOverrides', { keyPath: 'skuCode' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings');
      }
    },
  });
}
