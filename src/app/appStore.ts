import { createContext, useContext } from 'react';
import type {
  MinMaxDataset,
  OrderQtyEdit,
  OrderSettings,
  SupplierDataset,
  SupplierOverride,
  ValidationIssue,
} from '../domain/types';

export interface AppState {
  minMax: MinMaxDataset | null;
  suppliers: SupplierDataset | null;
  minMaxFileName: string | null;
  supplierFileName: string | null;
  minMaxIssues: ValidationIssue[];
  supplierIssues: ValidationIssue[];
  overrides: SupplierOverride[];
  edits: OrderQtyEdit[];
  settings: OrderSettings;
  exportedOrderIds: string[];
  page: string;
  toast: string | null;
  loading: boolean;
}

export interface Store {
  state: AppState;
  set: (patch: Partial<AppState>) => void;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('StoreContext is missing');
  }
  return store;
}
