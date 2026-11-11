import { createSupplierCatalog, mergeAssignmentChanges, mergeCatalogProducts, type SupplierCatalog } from '../domain/supplierCatalog';
import type { AppState } from './appStore';

export function attachSupplierCatalog(state: AppState, catalog: SupplierCatalog | null): AppState {
  return {
    ...state, catalog,
    ...(catalog && state.supplierAssignments === undefined ? {
      supplierAssignments: catalog.assignments,
      ...(catalog.source ? {
        suppliers: catalog.source.data, supplierIssues: catalog.source.issues,
        supplierFileName: catalog.source.fileName,
        rawImports: { ...state.rawImports, suppliers: catalog.source.ref },
      } : {}),
    } : {}),
  };
}

/** Catalog lifecycle belongs here, outside the session queue and React wiring. */
export function prepareCatalogState(previous: AppState, next: AppState): AppState {
  const catalog = previous.catalog;
  if (!catalog) return { ...next, catalog: createSupplierCatalog(next) };
  if (next.minMax && next.minMax !== previous.minMax) {
    const updated = mergeCatalogProducts(next.catalog ?? catalog, next.minMax.skus);
    const source = updated.source;
    return {
      ...next, catalog: updated, supplierAssignments: updated.assignments,
      ...(source ? {
        suppliers: source.data, supplierIssues: source.issues, supplierFileName: source.fileName,
        rawImports: { ...next.rawImports, suppliers: source.ref },
      } : {}),
    };
  }
  if (next.catalog && next.catalog !== catalog) return {
    ...next,
    supplierAssignments: mergeAssignmentChanges(next.supplierAssignments ?? [], catalog.assignments, next.catalog.assignments),
  };
  if (next.supplierAssignments !== previous.supplierAssignments) {
    const assignments = mergeAssignmentChanges(catalog.assignments, previous.supplierAssignments ?? [], next.supplierAssignments ?? []);
    return assignments === catalog.assignments ? next : {
      ...next, catalog: { ...catalog, assignments, revision: catalog.revision + 1 },
    };
  }
  return next;
}
