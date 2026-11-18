import { describe, expect, it } from 'vitest';
import { addCatalogSupplier, createSupplierCatalog, mergeCatalogProducts, changeCatalogAssignment } from '../../src/domain/supplierCatalog';
import { baseState } from '../ui/renderWithStore';

const first = 'ИП Баранов Роман Борисович';
const second = 'ИП Никишин Андрей Николаевич';

describe('independent supplier catalog', () => {
  it('migrates active assignments only, while recovering absent product identities from history', () => {
    const active = baseState({ supplierAssignments: [] });
    const older = baseState({ supplierAssignments: [{ skuCode: 'OLD', primary: first, additional: [] }] });
    older.minMax!.skus = [{ ...older.minMax!.skus[0]!, code: 'OLD', article: '000123' }];
    const catalog = createSupplierCatalog(active, [older])!;
    expect(catalog.assignments).toEqual([]);
    expect(catalog.products.find((p) => p.code === 'OLD')).toMatchObject({ article: '000123' });
    expect(catalog.products.find((p) => p.code === 'SKU1')).toMatchObject({ article: 'A-1' });
  });

  it('retains absent goods and explicitly cleared links when MIN/MAX refreshes identities', () => {
    const catalog = createSupplierCatalog(baseState())!;
    const cleared = changeCatalogAssignment(catalog, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: null });
    const updated = mergeCatalogProducts(cleared, [{ code: 'NEW', name: 'Новый товар', article: '000045' }]);
    expect(updated.products.map((p) => p.code)).toEqual(['SKU1', 'NEW']);
    expect(updated.assignments).toEqual([]);
    expect(mergeCatalogProducts(updated, [{ code: 'NEW', name: 'Новый товар', article: '000045' }])).toBe(updated);
  });

  it('changes only exact codes and keeps the former primary as additional', () => {
    const catalog = createSupplierCatalog(baseState())!;
    const changed = changeCatalogAssignment(catalog, { kind: 'set-primary', skuCodes: ['SKU1'], supplier: second });
    expect(changed.assignments).toEqual([{ skuCode: 'SKU1', primary: second, additional: [first] }]);
    expect(changed.revision).toBe(catalog.revision + 1);
    expect(catalog.assignments[0]?.primary).toBe(first);
  });

  it('adds a legal name to an existing shared list and rejects equivalent names', () => {
    const catalog = { ...createSupplierCatalog(baseState())!, suppliers: [first] };
    const added = addCatalogSupplier(catalog, '  ООО "САБЛАЙН   СЕРВИС"  ');
    expect(added.suppliers).toEqual([first, 'ООО "САБЛАЙН СЕРВИС"']);
    expect(added.revision).toBe(catalog.revision + 1);
    expect(added.assignments).toBe(catalog.assignments);
    expect(() => addCatalogSupplier(added, 'ооо «Саблайн Сервис»')).toThrow('уже есть');
    expect(() => addCatalogSupplier(added, '  ')).toThrow('Введите');
  });

  it('does not initialize before the two startup reports have established assignments', () => {
    const state = baseState();
    delete state.supplierAssignments;
    expect(createSupplierCatalog(state)).toBeNull();
  });
});
