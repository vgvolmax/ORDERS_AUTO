import { useState } from 'react';
import { VirtualTable } from '../../components/VirtualTable';
import { SearchInput } from '../../components/ui';
import type {
  AllocationContext,
  DonorAllocationRow,
} from '../../domain/rebalancing/allocationPlan';
import { money } from '../demand/DemandPage';

export function DonorPriorities({
  rows,
  context,
  onOpen,
}: {
  rows: DonorAllocationRow[];
  context: AllocationContext | null;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [shortagesOnly, setShortagesOnly] = useState(false);
  const donors = [...new Set(rows.map((r) => r.fromBranchId))];
  const names = new Map(context?.snapshot.branches.map((b) => [b.id, b.name]));
  const prices = new Map(
    context?.snapshot.skus.map((s) => [s.skuCode, s.referencePrice]),
  );
  const total = (lines: { skuCode: string; qty: number }[]) =>
    lines.some((t) => prices.get(t.skuCode) == null)
      ? 'Сумма неизвестна'
      : money(lines.reduce((n, t) => n + t.qty * prices.get(t.skuCode)!, 0));
  const visible = donors.filter(
    (id) =>
      (!shortagesOnly ||
        rows.some((r) => r.fromBranchId === id && r.priorityRequired)) &&
      (names.get(id) ?? id)
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
  );
  return (
    <section className="panel donor-priorities">
      <div className="section-heading">
        <h2>Приоритеты отправлений</h2>
        <span>{donors.length} доноров</span>
      </div>
      <p>
        Откройте донора, выберите получателей для каждого товара и проверьте
        количества. Заказы изменятся после принятия перемещений.
      </p>
      <div className="filters compact-filters">
        <label>
          Поиск донора
          <SearchInput value={query} onValueChange={setQuery} />
        </label>
        <label className="checkbox-control">
          <input
            type="checkbox"
            checked={shortagesOnly}
            onChange={(e) => setShortagesOnly(e.target.checked)}
          />
          Только нужны приоритеты
        </label>
      </div>
      <VirtualTable
        rows={visible}
        getRowKey={(id) => id}
        emptyMessage={
          context
            ? 'Нет доноров по выбранным условиям и фильтрам.'
            : 'Сначала рассчитайте перемещения.'
        }
        columns={[
          {
            key: 'donor',
            header: 'Донор · план · решение',
            width: 'minmax(0, 1fr)',
            render: (id) => {
              const group = rows.filter((r) => r.fromBranchId === id),
                unresolved = group.filter((r) => r.priorityRequired).length;
              const pending = group
                .map((r) => ({ skuCode: r.skuCode, qty: r.plannedQty }))
                .filter((r) => r.qty > 0);
              const rejected = group.flatMap((r) =>
                r.cells
                  .filter((c) => c.rejectedQty > 0)
                  .map((c) => ({ skuCode: r.skuCode, qty: c.rejectedQty })),
              );
              const accepted =
                context?.accepted.filter((t) => t.fromBranchId === id) ?? [];
              return (
                <button
                  className="donor-card"
                  aria-label={`Приоритеты ${names.get(id) ?? id}`}
                  onClick={() => onOpen(id)}
                >
                  <strong>{names.get(id) ?? id}</strong>
                  <span>
                    {group.length} SKU · Предложения: {total(pending)}
                  </span>
                  <span>
                    Принято: {total(accepted)} · {accepted.length} строк
                  </span>
                  <b className={unresolved ? 'warning-text' : 'success'}>
                    {unresolved
                      ? `Нужны приоритеты: ${unresolved} SKU`
                      : 'Можно проверить и принять'}
                  </b>
                  <span aria-hidden="true">Открыть →</span>
                  {rejected.length > 0 && (
                    <span className="warning-text">
                      В предложениях отклонено: {total(rejected)}
                    </span>
                  )}
                </button>
              );
            },
          },
        ]}
      />
    </section>
  );
}
