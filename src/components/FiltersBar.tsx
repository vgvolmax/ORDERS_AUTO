import type { StockStatus } from '../domain/types';
import { stockStatusLabels } from './StatusBadge';
import { Input, Select } from './ui';

export interface DemandFilters {
  query: string;
  status: StockStatus | 'ALL';
  supplier: string;
  amountFrom: string;
  amountTo: string;
  onlyInOrders: boolean;
  problemsOnly: boolean;
}

export const emptyDemandFilters: DemandFilters = {
  query: '',
  status: 'ALL',
  supplier: '',
  amountFrom: '',
  amountTo: '',
  onlyInOrders: false,
  problemsOnly: false,
};

export function FiltersBar({
  value,
  onChange,
  suppliers,
  resultCount,
}: {
  value: DemandFilters;
  onChange: (next: DemandFilters) => void;
  suppliers: string[];
  resultCount: number;
}) {
  const update = <K extends keyof DemandFilters>(key: K, next: DemandFilters[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <section className="filters" aria-label="Фильтры">
      <label className="filter-search">
        Поиск по коду, артикулу или названию
        <Input
          value={value.query}
          onChange={(event) => update('query', event.target.value)}
          placeholder="Например, 40748 или герметик"
        />
      </label>

      <label>
        Статус
        <Select
          value={value.status}
          onChange={(event) =>
            update('status', event.target.value as DemandFilters['status'])
          }
        >
          <option value="ALL">Все статусы</option>
          {Object.entries(stockStatusLabels).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </Select>
      </label>

      <label>
        Поставщик
        <Select
          value={value.supplier}
          onChange={(event) => update('supplier', event.target.value)}
        >
          <option value="">Все поставщики</option>
          <option value="__UNASSIGNED__">Не выбран поставщик</option>
          {suppliers.map((supplier) => (
            <option key={supplier} value={supplier}>
              {supplier}
            </option>
          ))}
        </Select>
      </label>

      <label>
        Потребность ₽ от
        <Input
          type="number"
          min="0"
          value={value.amountFrom}
          onChange={(event) => update('amountFrom', event.target.value)}
        />
      </label>

      <label>
        до
        <Input
          type="number"
          min="0"
          value={value.amountTo}
          onChange={(event) => update('amountTo', event.target.value)}
        />
      </label>

      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={value.onlyInOrders}
          onChange={(event) => update('onlyInOrders', event.target.checked)}
        />
        Только попадающие в заказ
      </label>

      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={value.problemsOnly}
          onChange={(event) => update('problemsOnly', event.target.checked)}
        />
        Только с проблемами
      </label>

      <div className="filter-result">
        Найдено: <strong>{resultCount}</strong>
      </div>

      {JSON.stringify(value) !== JSON.stringify(emptyDemandFilters) && (
        <button className="link" onClick={() => onChange(emptyDemandFilters)}>
          Сбросить фильтры
        </button>
      )}
    </section>
  );
}
