import { describe, expect, it } from 'vitest';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { SUPPLIER_POOL } from '../../src/domain/supplierPool';
import {
  applySharedCatalog, ensureAppBoxSize, parseSharedCatalog, sharedCatalogFromLocal,
  sharedCatalogJson,
} from '../../src/domain/sharedSupplierCatalog';
import { baseState } from '../ui/renderWithStore';

const first = SUPPLIER_POOL[0]!;
const second = SUPPLIER_POOL[1]!;

function sample() {
  return {
    kind: 'volmax-supplier-catalog' as const,
    schemaVersion: 1 as const,
    suppliers: [first, second],
    products: [{ code: '000123', article: '40727', name: 'Лён чесаный', unit: 'шт' }],
    assignments: [{ skuCode: '000123', primary: first, additional: [second] }],
  };
}

describe('portable shared supplier catalog', () => {
  it('exports a compact copy without source purchase history or workstation state', () => {
    const catalog = createSupplierCatalog(baseState())!;
    const json = sharedCatalogJson(sharedCatalogFromLocal(catalog));
    expect(json).not.toContain('purchaseAmount');
    expect(json).not.toContain('branchStocks');
    expect(json).toContain('SKU1');
    const restored = parseSharedCatalog(json);
    expect(restored.assignments).toEqual(catalog.assignments);
    expect(restored.suppliers).toEqual(SUPPLIER_POOL);
    expect(restored.products[0]?.unit).toBe('шт');
  });

  it('preserves 1C text codes, primary/additional roles, and the local source on import', () => {
    const catalog = createSupplierCatalog(baseState())!;
    const imported = parseSharedCatalog(sample());
    const next = applySharedCatalog(catalog, imported, [{
      code: 'NEW', article: '0012', name: 'Новый', referencePrice: 100, reportedTotalStock: 0,
    }]);
    expect(next.products.find((p) => p.code === '000123')?.article).toBe('40727');
    expect(next.products.find((p) => p.code === 'NEW')?.article).toBe('0012');
    expect(next.assignments).toEqual(imported.assignments);
    expect(next.source).toBe(catalog.source);
    expect(next.suppliers).toEqual([first, second]);
  });

  it('rejects malformed documents without silently accepting broken mappings', () => {
    expect(() => parseSharedCatalog({ ...sample(), schemaVersion: 2 })).toThrow();
    expect(() => parseSharedCatalog({ ...sample(), suppliers: [first, first] })).toThrow(/Повторяются/);
    expect(() => parseSharedCatalog({ ...sample(), assignments: [
      { skuCode: '000123', primary: 'НЕИЗВЕСТНЫЙ', additional: [] },
    ] })).toThrow(/отсутствует поставщик/);
    expect(() => parseSharedCatalog({ ...sample(), assignments: [
      { skuCode: '000123', primary: first, additional: [first] },
    ] })).toThrow(/дубли/);
    expect(() => parseSharedCatalog({ ...sample(), assignments: [
      ...sample().assignments, ...sample().assignments,
    ] })).toThrow(/повторные/);
    expect(() => parseSharedCatalog({ ...sample(), products: [
      ...sample().products, ...sample().products,
    ] })).toThrow(/Повторяющийся код/);
    expect(() => parseSharedCatalog('garbled-json')).toThrow(/Некорректный JSON/);
  });

  it('checks AppBox 2 MiB limit instead of truncating real data', () => {
    const doc = sample();
    const big = { ...doc, products: [{ code: '000123', article: null, name: 'X'.repeat(2 * 1024 * 1024) }] };
    expect(() => ensureAppBoxSize(big)).toThrow(/2 МиБ/);
    expect(() => parseSharedCatalog(big)).toThrow(/2 МиБ/);
  });
});
