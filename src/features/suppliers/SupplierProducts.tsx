import { useLayoutEffect, useMemo, useRef } from 'react';
import { VirtualTable } from '../../components/VirtualTable';
import { productColumns } from '../../components/productColumns';
import { Button, SearchInput, Select } from '../../components/ui';
import type { SupplierAssignment } from '../../domain/supplierAssignments';
import { SUPPLIER_POOL } from '../../domain/supplierPool';
import type { CatalogProduct } from '../../domain/supplierCatalog';

type PrimaryFilter = 'all' | 'with-primary' | 'without-primary';
export type SupplierRole = 'any' | 'primary' | 'additional';
export interface ProductFilters {
  presence?: 'all' | 'current' | 'absent';
  query: string;
  primary: PrimaryFilter;
  supplier: string;
  role: SupplierRole;
  hasDemand: boolean;
}

export const defaultProductFilters: ProductFilters = {
  presence: 'all',
  query: '',
  primary: 'all',
  supplier: '',
  role: 'any',
  hasDemand: false,
};

const productKey = (sku: CatalogProduct) => sku.code;

export function SupplierProducts({
  active,
  products,
  currentCodes,
  assignmentsByCode,
  demandCodes,
  filters,
  onFiltersChange,
  selectedCodes,
  onSelect,
  onOpenProduct,
  onOpenBulk,
}: {
  active: boolean;
  products: CatalogProduct[];
  currentCodes: ReadonlySet<string>;
  assignmentsByCode: ReadonlyMap<string, SupplierAssignment>;
  demandCodes: ReadonlySet<string>;
  filters: ProductFilters;
  onFiltersChange: (filters: ProductFilters) => void;
  selectedCodes: string[];
  onSelect: (codes: string[]) => void;
  onOpenProduct: (code: string) => void;
  onOpenBulk: () => void;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase('ru-RU');
    return products.filter((sku) => {
      if (filters.presence === 'current' && !currentCodes.has(sku.code)) return false;
      if (filters.presence === 'absent' && currentCodes.has(sku.code)) return false;
      const assignment = assignmentsByCode.get(sku.code);
      const primary = assignment?.primary;
      if (filters.primary === 'with-primary' && !primary) return false;
      if (filters.primary === 'without-primary' && primary) return false;
      if (filters.hasDemand && !demandCodes.has(sku.code)) return false;
      if (filters.supplier) {
        const main = filters.role !== 'additional' && primary === filters.supplier;
        const extra = filters.role !== 'primary' && assignment?.additional.includes(filters.supplier);
        if (!main && !extra) return false;
      }
      return !query || [sku.code, sku.article, sku.name].some(
        (value) => value?.toLocaleLowerCase('ru-RU').includes(query),
      );
    });
  }, [products, filters, assignmentsByCode, demandCodes, currentCodes]);
  const selected = useMemo(() => new Set(selectedCodes), [selectedCodes]);
  const selectedVisible = visible.reduce((total, sku) => total + Number(selected.has(sku.code)), 0);
  const allSelected = visible.length > 0 && selectedVisible === visible.length;

  useLayoutEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedVisible > 0 && !allSelected;
  }, [allSelected, selectedVisible]);

  useLayoutEffect(() => {
    const node = tableRef.current?.querySelector<HTMLElement>('.virtual-scroll');
    if (node) {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    }
  }, [filters]);

  function setChecked(codes: string[], checked: boolean) {
    const next = new Set(selected);
    for (const code of codes) {
      if (checked) next.add(code);
      else next.delete(code);
    }
    onSelect([...next]);
  }

  return (
    <section className="supplier-products-view" hidden={!active} inert={!active} aria-label="Товары">
      <div className="filters compact-filters supplier-product-filters" role="group" aria-label="Фильтры товаров">
        <label>
          Поиск товара
          <SearchInput
            aria-label="Поиск товара"
            value={filters.query}
            placeholder="Код 1С, артикул, название"
            onValueChange={(query) => onFiltersChange({ ...filters, query })}
          />
        </label>
        <label>
          Наличие в MIN/MAX
          <Select value={filters.presence ?? 'all'} onChange={(event) =>
            onFiltersChange({ ...filters, presence: event.target.value as 'all' | 'current' | 'absent' })
          }>
            <option value="all">Все товары справочника</option>
            <option value="current">Есть в текущем MIN/MAX</option>
            <option value="absent">Нет в текущем MIN/MAX</option>
          </Select>
        </label>
        <label>
          Наличие основного
          <Select value={filters.primary} onChange={(event) =>
            onFiltersChange({ ...filters, primary: event.target.value as PrimaryFilter })
          }>
            <option value="all">Все</option>
            <option value="with-primary">С основным</option>
            <option value="without-primary">Без основного</option>
          </Select>
        </label>
        <label>
          Поставщик
          <Select value={filters.supplier} onChange={(event) =>
            onFiltersChange({ ...filters, supplier: event.target.value, role: event.target.value ? filters.role : 'any' })
          }>
            <option value="">Все поставщики</option>
            {SUPPLIER_POOL.map((supplier) => <option key={supplier}>{supplier}</option>)}
          </Select>
        </label>
        <label>
          Роль поставщика
          <Select
            value={filters.role}
            disabled={!filters.supplier}
            onChange={(event) => onFiltersChange({ ...filters, role: event.target.value as SupplierRole })}
          >
            <option value="any">Любая</option>
            <option value="primary">Основной</option>
            <option value="additional">Дополнительный</option>
          </Select>
        </label>
        <label className="checkbox-control">
          <input
            type="checkbox"
            checked={filters.hasDemand}
            onChange={(event) => onFiltersChange({ ...filters, hasDemand: event.target.checked })}
          />
          Есть потребность
        </label>
      </div>
      <div className="supplier-bulk-bar">
        <label className="checkbox-control">
          <input
            ref={selectAllRef}
            type="checkbox"
            aria-label="Выбрать все позиции"
            checked={allSelected}
            disabled={!visible.length}
            onChange={(event) => setChecked(visible.map((sku) => sku.code), event.target.checked)}
          />
          Отметить все по фильтрам
        </label>
        <small role="status">
          Найдено: {visible.length} · Отмечено: {selected.size}
          {selected.size > selectedVisible && ` · Вне фильтров: ${selected.size - selectedVisible}`}
        </small>
        {selected.size > 0 && (
          <Button className="secondary" onClick={() => onSelect([])}>Снять отметки</Button>
        )}
        <Button disabled={!selected.size} onClick={onOpenBulk}>Назначить основного выбранным</Button>
      </div>
      <div ref={tableRef}>
        <VirtualTable
          rows={visible}
          getRowKey={productKey}
          maxHeight="min(58vh, 700px)"
          emptyMessage={products.length ? 'Нет товаров по выбранным фильтрам.' : 'В справочнике нет товаров.'}
          columns={[
            {
              key: 'check',
              header: <span className="sr-only">Выбор</span>,
              width: '42px',
              render: (sku) => (
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${sku.code}`}
                  checked={selected.has(sku.code)}
                  onChange={(event) => setChecked([sku.code], event.target.checked)}
                />
              ),
            },
            ...productColumns<CatalogProduct>((sku) => ({ code: sku.code, article: sku.article, name: sku.name }), {
              code: { width: '130px' },
              article: { width: '110px' },
              name: { width: 'minmax(210px,1.25fr)' },
            }),
            {
              key: 'primary',
              header: 'Основной поставщик',
              width: 'minmax(165px,1fr)',
              render: (sku) => assignmentsByCode.get(sku.code)?.primary ?? 'Не назначен',
            },
            {
              key: 'additional',
              header: 'Дополнительные',
              width: '125px',
              render: (sku) => assignmentsByCode.get(sku.code)?.additional.length ?? 0,
            },
            {
              key: 'demand',
              header: 'Текущий MIN/MAX',
              width: '120px',
              render: (sku) => (
                <>
                  <div>{currentCodes.has(sku.code) ? 'Есть в MIN/MAX' : 'Нет в MIN/MAX'}</div>
                  {currentCodes.has(sku.code) && <small>{demandCodes.has(sku.code) ? 'Есть потребность' : 'Без потребности'}</small>}
                </>
              ),
            },
            {
              key: 'links',
              header: 'Связи',
              width: '92px',
              render: (sku) => (
                <Button className="secondary" aria-label={`Связи ${sku.code}`} onClick={() => onOpenProduct(sku.code)}>
                  Связи
                </Button>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}
