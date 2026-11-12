import { createSupplierCatalog, mergeAssignmentChanges, mergeCatalogProducts, type SupplierCatalog } from '../domain/supplierCatalog';
import type { AppState } from './appStore';
import { snapshotSupplierContext } from '../domain/supplierContext';
import { freezeAcceptedDocuments } from './acceptedDocumentContext';
import { derive } from './selectors';
import { changedOrderIds } from '../domain/rebalanceWorkflow';

export function attachSupplierCatalog(state: AppState, catalog: SupplierCatalog | null): AppState {
  const accepted = freezeAcceptedDocuments(state);
  const next = {
    ...state, catalog, rebalance: accepted === state.rebalance.accepted ? state.rebalance : { ...state.rebalance, accepted },
    ...(catalog ? {
      supplierAssignments: catalog.assignments, supplierContext: snapshotSupplierContext(catalog),
      ...(state.supplierAssignments === undefined && catalog.source ? {
        suppliers: catalog.source.data, supplierIssues: catalog.source.issues,
        supplierFileName: catalog.source.fileName,
        rawImports: { ...state.rawImports, suppliers: catalog.source.ref },
      } : {}),
    } : {}),
  };
  if (!catalog || !state.minMax || (!state.reviewedOrderIds.length && !state.exportedOrderIds.length)) return next;
  const affected = changedOrderIds(derive(state).projection.orders, derive(next).projection.orders);
  return { ...next,
    reviewedOrderIds: next.reviewedOrderIds.filter(id => !affected.has(id)),
    exportedOrderIds: next.exportedOrderIds.filter(id => !affected.has(id)),
  };
}

/** Catalog lifecycle belongs here, outside the session queue and React wiring. */
export function prepareCatalogState(previous: AppState, next: AppState): AppState {
  const catalog = previous.catalog;
  if (!catalog) return next.catalog
    ? { ...next, supplierAssignments: next.catalog.assignments }
    : { ...next, catalog: createSupplierCatalog(next) };
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
    supplierAssignments: next.catalog.assignments,
  };
  if (next.supplierAssignments !== previous.supplierAssignments) {
    const assignments = mergeAssignmentChanges(catalog.assignments, previous.supplierAssignments ?? [], next.supplierAssignments ?? []);
    return assignments === catalog.assignments ? next : {
      ...next, catalog: { ...catalog, assignments, revision: catalog.revision + 1 },
    };
  }
  return next;
}
