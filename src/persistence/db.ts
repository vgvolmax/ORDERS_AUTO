import { openDB, type DBSchema } from 'idb';
import type { OrderSettings, SupplierOverride } from '../domain/types';

interface OrdersAutoSchema extends DBSchema {
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
  return openDB<OrdersAutoSchema>('orders-auto', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('supplierOverrides')) {
        database.createObjectStore('supplierOverrides', { keyPath: 'skuCode' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings');
      }
    },
  });
}
