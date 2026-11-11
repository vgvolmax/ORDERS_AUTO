import { applySupplierAssignmentChange, type SupplierAssignment, type SupplierAssignmentCommand } from './supplierAssignments';
import type { Sku, SupplierDataset, ValidationIssue } from './types';
import type { ImportFileRef, WorkspaceData } from './workspace';

export type CatalogProduct = Pick<Sku, 'code' | 'article' | 'name'>;
export interface SupplierCatalog {
  schemaVersion: 1;
  revision: number;
  products: CatalogProduct[];
  assignments: SupplierAssignment[];
  source: {
    data: SupplierDataset;
    issues: ValidationIssue[];
    fileName: string | null;
    ref: ImportFileRef | null;
  } | null;
}

/** The active workspace alone owns migrated choices; history only fills identities. */
export function createSupplierCatalog(data: WorkspaceData, history: readonly Pick<WorkspaceData, 'minMax'>[] = []): SupplierCatalog | null {
  if (data.supplierAssignments === undefined) return null;
  const products = new Map<string, CatalogProduct>();
  for (const workspace of [data, ...history]) {
    for (const { code, article, name } of workspace.minMax?.skus ?? []) {
      if (!products.has(code)) products.set(code, { code, article, name });
    }
  }
  for (const row of data.suppliers?.history ?? []) {
    if (!products.has(row.skuCode)) products.set(row.skuCode, {
      code: row.skuCode, article: null, name: row.skuName || row.skuCode,
    });
  }
  for (const { skuCode } of data.supplierAssignments) {
    if (!products.has(skuCode)) products.set(skuCode, { code: skuCode, article: null, name: skuCode });
  }
  return {
    schemaVersion: 1, revision: 0, products: [...products.values()],
    assignments: data.supplierAssignments,
    source: data.suppliers ? {
      data: data.suppliers, issues: data.supplierIssues,
      fileName: data.supplierFileName, ref: data.rawImports.suppliers,
    } : null,
  };
}

export function mergeCatalogProducts(catalog: SupplierCatalog, incoming: readonly CatalogProduct[]): SupplierCatalog {
  const products = new Map(catalog.products.map((product) => [product.code, product]));
  let changed = false;
  for (const { code, article, name } of incoming) {
    const previous = products.get(code);
    if (previous?.article === article && previous?.name === name) continue;
    products.set(code, { code, article, name });
    changed = true;
  }
  return changed ? { ...catalog, revision: catalog.revision + 1, products: [...products.values()] } : catalog;
}

export function changeCatalogAssignment(catalog: SupplierCatalog, command: SupplierAssignmentCommand): SupplierCatalog {
  const codes = command.kind === 'set-primary' ? command.skuCodes : [command.skuCode];
  const known = new Set(catalog.products.map((product) => product.code));
  if (codes.some((code) => !known.has(code))) throw new Error('Товар не найден в справочнике. Обновите страницу.');
  const assignments = applySupplierAssignmentChange(catalog.assignments, command);
  return assignments === catalog.assignments ? catalog : { ...catalog, assignments, revision: catalog.revision + 1 };
}

function sameAssignment(a: SupplierAssignment | undefined, b: SupplierAssignment | undefined) {
  return (a?.primary ?? null) === (b?.primary ?? null) &&
    (a?.additional.length ?? 0) === (b?.additional.length ?? 0) &&
    (a?.additional ?? []).every((value, i) => value === b?.additional[i]);
}

/** Apply only changed codes, preserving unrelated historical or current choices. */
export function mergeAssignmentChanges(
  target: SupplierAssignment[], before: readonly SupplierAssignment[], after: readonly SupplierAssignment[],
): SupplierAssignment[] {
  const old = new Map(before.map((row) => [row.skuCode, row]));
  const next = new Map(after.map((row) => [row.skuCode, row]));
  const result = new Map(target.map((row) => [row.skuCode, row]));
  let changed = false;
  for (const code of new Set([...old.keys(), ...next.keys()])) {
    if (sameAssignment(old.get(code), next.get(code)) || sameAssignment(result.get(code), next.get(code))) continue;
    const row = next.get(code);
    if (row) result.set(code, row);
    else result.delete(code);
    changed = true;
  }
  return changed ? [...result.values()] : target;
}
