import type { CatalogProduct, SupplierCatalog } from './supplierCatalog';
import type { SupplierAssignment } from './supplierAssignments';
import type { Sku } from './types';
import { supplierKey } from './supplierPool';

export const SHARED_CATALOG_FILENAME = 'volmax-supplier-catalog.json';
export const APPBOX_JSON_LIMIT = 2 * 1024 * 1024;

export interface SharedSupplierCatalog {
  kind: 'volmax-supplier-catalog';
  schemaVersion: 1;
  suppliers: string[];
  products: CatalogProduct[];
  assignments: SupplierAssignment[];
}

const nonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function sharedCatalogFromLocal(catalog: SupplierCatalog): SharedSupplierCatalog {
  return {
    kind: 'volmax-supplier-catalog',
    schemaVersion: 1,
    suppliers: [...(catalog.suppliers ?? [])],
    products: catalog.products.map(({ code, article, name, unit }) => ({
      code, article, name, ...(unit ? { unit } : {}),
    })),
    assignments: catalog.assignments.map(({ skuCode, primary, additional }) => ({
      skuCode, primary, additional: [...additional],
    })),
  };
}

export function sharedCatalogJson(document: SharedSupplierCatalog): string {
  return JSON.stringify(document, null, 2);
}

export function ensureAppBoxSize(document: SharedSupplierCatalog): void {
  const size = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  if (size > APPBOX_JSON_LIMIT) {
    throw new Error('Справочник больше 2 МиБ. AppBoxFiles не сохранит его. Скачайте полную копию на компьютер.');
  }
}

/** Never trust an imported document before parsing and validating every link. */
export function parseSharedCatalog(input: unknown): SharedSupplierCatalog {
  let value: unknown = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch {
      throw new Error('Некорректный JSON справочника.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Ожидался объект JSON справочника.');
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== 'volmax-supplier-catalog' || record.schemaVersion !== 1) {
    throw new Error('Неподдерживаемый тип или версия справочника.');
  }
  if (!Array.isArray(record.suppliers) || !Array.isArray(record.products) || !Array.isArray(record.assignments)) {
    throw new Error('В справочнике отсутствуют массивы suppliers, products или assignments.');
  }
  const suppliers = record.suppliers;
  if (!suppliers.length || !suppliers.every(nonBlank)) {
    throw new Error('Список поставщиков пуст или содержит некорректное наименование.');
  }
  const keys = new Set(suppliers.map((name) => supplierKey(name as string)));
  if (keys.size !== suppliers.length) throw new Error('Повторяются поставщики с одинаковым названием.');
  const canonical = new Map(suppliers.map((name) => [supplierKey(name as string), name as string]));
  const products: CatalogProduct[] = [];
  const codes = new Set<string>();
  for (const item of record.products) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Некорректная запись товара.');
    const product = item as Record<string, unknown>;
    if (!nonBlank(product.code) || !nonBlank(product.name) ||
        (product.article !== null && typeof product.article !== 'string') ||
        (product.unit !== undefined && product.unit !== null && typeof product.unit !== 'string')) {
      throw new Error('Товар должен содержать код 1С, название и корректный артикул.');
    }
    if (codes.has(product.code)) throw new Error('Повторяющийся код 1С: ' + product.code);
    codes.add(product.code);
    products.push({
      code: product.code, name: product.name, article: product.article as string | null,
      ...(nonBlank(product.unit) ? { unit: product.unit } : {}),
    });
  }
  const assignments: SupplierAssignment[] = [];
  const assigned = new Set<string>();
  for (const item of record.assignments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Некорректная связь поставщика.');
    const row = item as Record<string, unknown>;
    if (!nonBlank(row.skuCode) || !codes.has(row.skuCode) || assigned.has(row.skuCode) ||
        (row.primary !== null && !nonBlank(row.primary)) || !Array.isArray(row.additional) ||
        !row.additional.every(nonBlank)) {
      throw new Error('Некорректные или повторные связи товара ' + String(row.skuCode));
    }
    const primary = row.primary === null ? null : canonical.get(supplierKey(row.primary as string));
    const additional = row.additional.map((name) => canonical.get(supplierKey(name as string)));
    if ((row.primary !== null && !primary) || additional.some((name) => !name) ||
        new Set(additional).size !== additional.length || (primary && additional.includes(primary))) {
      throw new Error('В связях товара ' + row.skuCode + ' отсутствует поставщик или есть дубли.');
    }
    assigned.add(row.skuCode);
    assignments.push({ skuCode: row.skuCode, primary: primary ?? null, additional: additional as string[] });
  }
  const document: SharedSupplierCatalog = {
    kind: 'volmax-supplier-catalog', schemaVersion: 1,
    suppliers: suppliers as string[], products, assignments,
  };
  ensureAppBoxSize(document);
  return document;
}

/** The shared document owns links; local 1C only supplies current SKU identities. */
export function applySharedCatalog(
  current: SupplierCatalog | null,
  document: SharedSupplierCatalog,
  minMaxSkus: readonly Sku[] = [],
): SupplierCatalog {
  const products = new Map(document.products.map((product) => [product.code, product]));
  for (const sku of minMaxSkus) {
    const previous = products.get(sku.code);
    products.set(sku.code, {
      code: sku.code, article: sku.article, name: sku.name,
      ...(previous?.unit ? { unit: previous.unit } : {}),
    });
  }
  return {
    schemaVersion: 1,
    revision: (current?.revision ?? -1) + 1,
    products: [...products.values()],
    assignments: document.assignments.map((item) => ({ ...item, additional: [...item.additional] })),
    suppliers: [...document.suppliers],
    source: current?.source ?? null,
  };
}
