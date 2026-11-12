import type { SupplierCatalog } from './supplierCatalog';
import { SUPPLIER_POOL } from './supplierPool';

/** Small immutable purchasing context; never a copy of the live shared document. */
export interface SupplierContext {
  suppliers: string[];
  products: { code: string; unit: string }[];
}

export function snapshotSupplierContext(catalog: SupplierCatalog): SupplierContext {
  return {
    suppliers: [...(catalog.suppliers ?? SUPPLIER_POOL)],
    products: catalog.products.flatMap(product => product.unit ? [{ code: product.code, unit: product.unit }] : []),
  };
}
