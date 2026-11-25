import { normalizeText } from './normalize';
import { applySharedCatalog, type SharedSupplierCatalog } from './sharedSupplierCatalog';
import {
  addCatalogSupplier, changeCatalogAssignment, type CatalogProduct, type SupplierCatalog,
} from './supplierCatalog';
import type { SupplierAssignmentCommand } from './supplierAssignments';
import { SUPPLIER_POOL } from './supplierPool';
import { WorkspaceConflictError } from './workspace';

export type CatalogChange =
  | { kind: 'create' }
  | { kind: 'restore'; backup: SharedSupplierCatalog }
  | { kind: 'add-supplier'; name: string }
  | { kind: 'assign'; command: SupplierAssignmentCommand }
  | { kind: 'save-product'; product: CatalogProduct; isNew: boolean };

export interface CatalogBase {
  catalog: SupplierCatalog | null;
  catalogRevision: number | null;
}

export function applyCatalogChange(change: CatalogChange, latest: CatalogBase, base: CatalogBase): SupplierCatalog {
  switch (change.kind) {
    case 'create':
      if (latest.catalogRevision !== null)
        throw new WorkspaceConflictError('Справочник уже создан. Обновите документ.');
      return latest.catalog ?? applySharedCatalog(null, {
        kind: 'volmax-supplier-catalog', schemaVersion: 1, suppliers: [...SUPPLIER_POOL],
        products: [], assignments: [],
      });
    case 'restore':
      if (latest.catalogRevision !== base.catalogRevision)
        throw new WorkspaceConflictError('Справочник изменился после выбора копии. Проверьте текущую версию и повторите восстановление.');
      return applySharedCatalog(null, change.backup);
    case 'add-supplier':
    case 'assign':
    case 'save-product':
      break;
  }

  const { catalog } = latest;
  if (!catalog || !base.catalog || latest.catalogRevision === null)
    throw new Error('Откройте исходный справочник AppBox.');
  if (change.kind === 'add-supplier') return addCatalogSupplier(catalog, change.name);

  if (change.kind === 'assign') {
    const { command } = change;
    const codes = command.kind === 'set-primary' ? command.skuCodes : [command.skuCode];
    const before = new Map(base.catalog.assignments.map((row) => [row.skuCode, row]));
    const now = new Map(catalog.assignments.map((row) => [row.skuCode, row]));
    const changedCode = codes.find((code) => {
      const a = before.get(code);
      const b = now.get(code);
      return (a?.primary ?? null) !== (b?.primary ?? null) ||
        JSON.stringify(a?.additional ?? []) !== JSON.stringify(b?.additional ?? []);
    });
    if (changedCode)
      throw new WorkspaceConflictError(`Связи товара ${changedCode} изменились. Проверьте актуальные назначения.`);
    return changeCatalogAssignment(catalog, command);
  }

  const { code, name, article, unit } = change.product;
  const productCode = code.trim();
  const productName = normalizeText(name);
  if (!productCode || !productName) throw new Error('Укажите код 1С и название товара.');
  const before = base.catalog.products.find((item) => item.code === productCode);
  const now = catalog.products.find((item) => item.code === productCode);
  if (change.isNew && now) throw new Error(`Товар с кодом 1С ${productCode} уже есть в справочнике.`);
  if (!change.isNew && !now) throw new Error(`Товар ${productCode} больше не найден в справочнике.`);
  if (before?.name !== now?.name || before?.article !== now?.article || before?.unit !== now?.unit)
    throw new WorkspaceConflictError(`Карточка товара ${productCode} изменилась. Проверьте актуальные реквизиты.`);
  const measure = unit && normalizeText(unit);
  const product = {
    code: productCode, name: productName, article: article?.trim() || null,
    ...(measure && { unit: measure }),
  };
  if (now && now.name === product.name && now.article === product.article && now.unit === product.unit)
    return catalog;
  return {
    ...catalog, revision: catalog.revision + 1,
    products: now
      ? catalog.products.map((item) => item.code === product.code ? product : item)
      : [...catalog.products, product],
  };
}
