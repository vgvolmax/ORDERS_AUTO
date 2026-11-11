import { useMemo } from 'react';
import { useStore } from '../../app/appStore';
import { usePreference } from '../../app/usePreference';
import { ThresholdControls } from '../../components/ThresholdControls';
import { EmptyState, Input, SearchInput } from '../../components/ui';
import { moneySum } from '../../domain/money';
import type { SupplierAssignment } from '../../domain/supplierAssignments';
import type { Order } from '../../domain/types';
import type { CatalogProduct } from '../../domain/supplierCatalog';
import { money } from '../../format/numbers';
import type { SupplierRole } from './SupplierProducts';

export function SupplierRoster({
  catalogAssignments,
  productsByCode,
  orders,
  suppliers,
  onShowProducts,
}: {
  catalogAssignments: ReadonlyMap<string, SupplierAssignment>;
  productsByCode: ReadonlyMap<string, CatalogProduct>;
  orders: Order[];
  suppliers: readonly string[];
  onShowProducts: (supplier: string, role: SupplierRole) => void;
}) {
  const { state, set, commit } = useStore();
  const [query, setQuery] = usePreference('suppliers:query', '');
  const [amountFrom, setAmountFrom] = usePreference('suppliers:amountFrom', '');
  const [showBelowThreshold, setShowBelowThreshold] = usePreference('suppliers:belowThreshold', false);
  const summaries = useMemo(() => {
    const bySupplier = new Map(suppliers.map((supplier) => [
      supplier,
      { supplier, primary: 0, additional: 0, orders: [] as Order[] },
    ]));
    for (const [code, assignment] of catalogAssignments) {
      if (!productsByCode.has(code)) continue;
      const primary = assignment.primary && bySupplier.get(assignment.primary);
      if (primary) primary.primary++;
      for (const name of assignment.additional) {
        const additional = bySupplier.get(name);
        if (additional) additional.additional++;
      }
    }
    for (const order of orders) bySupplier.get(order.supplier)?.orders.push(order);
    return [...bySupplier.values()].map((summary) => {
      const amounts: number[] = [];
      let missingPrices = 0;
      for (const order of summary.orders) {
        for (const line of order.lines) {
          if (line.orderQty <= 0) continue;
          if (line.amount === null) missingPrices++;
          else amounts.push(line.amount);
        }
      }
      return { ...summary, total: missingPrices ? null : moneySum(amounts), missingPrices };
    });
  }, [catalogAssignments, productsByCode, orders, suppliers]);

  const search = query.trim().toLocaleLowerCase('ru-RU');
  const minimumAmount = amountFrom === '' ? null : Number(amountFrom);
  const visible = summaries.filter(({ supplier, total }) =>
    supplier.toLocaleLowerCase('ru-RU').includes(search) &&
    (minimumAmount === null || (total !== null && total >= minimumAmount)),
  );

  return (
    <section aria-label="По поставщикам">
      <ThresholdControls
        settings={state.settings}
        onChange={async (settings) => {
          if (commit) await commit({ settings });
          else set({ settings });
        }}
        showBelowThreshold={showBelowThreshold}
        onShowBelowThresholdChange={setShowBelowThreshold}
      />
      <div className="filters compact-filters" role="group" aria-label="Фильтры поставщиков">
        <label>
          Поиск поставщика
          <SearchInput aria-label="Поиск поставщика" value={query} onValueChange={setQuery} placeholder="Название поставщика" />
        </label>
        <label>
          Потребность от, ₽
          <Input type="number" min="0" value={amountFrom} onChange={(event) => setAmountFrom(event.target.value)} />
        </label>
        <small>Найдено: {visible.length} из {suppliers.length}</small>
      </div>
      {visible.length > 0 ? (
        <div className="table-wrap supplier-table-wrap">
          <table aria-label="По поставщикам">
            <thead>
              <tr>
                <th scope="col">Поставщик</th>
                <th scope="col" className="num">Основных товаров</th>
                <th scope="col" className="num">Дополнительных товаров</th>
                <th scope="col" className="num">Сумма закупки</th>
                <th scope="col">Заказы по подразделениям</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((summary) => {
                const detailOrders = summary.orders.filter((order) => showBelowThreshold || !order.belowThreshold ||
                  order.blockers.some((blocker) => blocker !== 'Ниже минимальной суммы'));
                const hiddenOrders = summary.orders.length - detailOrders.length;
                return (
                  <tr key={summary.supplier}>
                    <th scope="row">
                      <button className="link" onClick={() => onShowProducts(summary.supplier, 'any')}>{summary.supplier}</button>
                    </th>
                    <td className="num">
                      <button
                        className="link"
                        aria-label={`Основные товары: ${summary.supplier}`}
                        onClick={() => onShowProducts(summary.supplier, 'primary')}
                      >{summary.primary}</button>
                    </td>
                    <td className="num">
                      <button
                        className="link"
                        aria-label={`Дополнительные товары: ${summary.supplier}`}
                        onClick={() => onShowProducts(summary.supplier, 'additional')}
                      >{summary.additional}</button>
                    </td>
                    <td className="num">
                      {summary.total === null ? (
                        <span className="danger-text">
                          Сумма неизвестна
                          <small>Без цены: {summary.missingPrices}</small>
                        </span>
                      ) : money(summary.total)}
                    </td>
                    <td>
                      {detailOrders.length > 0 ? (
                        <details>
                          <summary>{detailOrders.length} заказов</summary>
                          <div className="supplier-details">
                            {detailOrders.map((order) => (
                              <div key={order.id}>
                                <strong>{order.branch}</strong> · {order.totalAmount === null ? 'Сумма неизвестна' : money(order.totalAmount)}
                                {order.belowThreshold && <span className="threshold-warning"> · Ниже порога</span>}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : summary.orders.length === 0 ? 'Нет заказов' : null}
                      {hiddenOrders > 0 && <small className="threshold-warning">Скрыто ниже порога: {hiddenOrders}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState>Нет поставщиков по выбранным фильтрам.</EmptyState>}
      <p className="muted">Сумма закупки включает заказы ниже порога. Порог влияет на готовность заказа и видимость в списке подразделений.</p>
    </section>
  );
}
