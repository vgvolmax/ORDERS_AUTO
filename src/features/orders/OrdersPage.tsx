import { useMemo, useState } from 'react';
import { derive } from '../../app/selectors';
import { useStore } from '../../app/appStore';
import { ThresholdControls } from '../../components/ThresholdControls';
import { Alert, Button, EmptyState, Input, MetricCard } from '../../components/ui';
import type { Order } from '../../domain/types';
import { downloadCsv, downloadReadyOrdersZip, save } from '../../export/download';
import { supplierWorkbookFilename } from '../../export/orderFilenames';
import { buildSupplierWorkbook } from '../../export/supplierWorkbook';
import { fmtQty, money } from '../demand/DemandPage';
import { OrderDrawer } from './OrderDrawer';

export function OrdersPage() {
  const { state, set } = useStore();
  const derived = derive(state)!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [supplierQuery, setSupplierQuery] = useState('');
  const [showBelowThreshold, setShowBelowThreshold] = useState(false);

  const orders = derived.projection.orders;
  const visibleOrders = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase('ru-RU');
    return orders.filter((order) => {
      if (query && !order.supplier.toLocaleLowerCase('ru-RU').includes(query)) return false;
      if (!showBelowThreshold && order.belowThreshold && !hasHardBlocker(order)) return false;
      return true;
    });
  }, [orders, supplierQuery, showBelowThreshold]);
  const exportable = visibleOrders.filter(
    (order) => order.status === 'READY' || order.status === 'EXPORTED',
  );
  const suppliers = [...new Set(visibleOrders.map((order) => order.supplier))];
  const branches = state.minMax!.branches;
  const selected = selectedId
    ? orders.find((order) => order.id === selectedId) ?? null
    : null;

  const markExported = (ids: string[]) => {
    set({ exportedOrderIds: [...new Set([...(state.exportedOrderIds ?? []), ...ids])] });
  };

  async function zip() {
    if (exportable.length === 0) return;
    setBusy(`Формирование ${exportable.length} CSV…`);
    try {
      await downloadReadyOrdersZip(exportable);
      markExported(exportable.map((order) => order.id));
      set({ toast: `Создан ZIP: ${exportable.length} CSV.` });
    } catch (error) {
      console.error('Failed to export orders ZIP', error);
      set({ toast: 'Не удалось сформировать ZIP с заказами. Повторите выгрузку.' });
    } finally {
      setBusy('');
    }
  }

  async function excel(supplier: string) {
    const supplierOrders = visibleOrders.filter(
      (order) =>
        order.supplier === supplier &&
        (order.status === 'READY' || order.status === 'EXPORTED'),
    );
    if (supplierOrders.length === 0) return;
    setBusy(`Создание Excel для ${supplier}…`);
    try {
      const buffer = await buildSupplierWorkbook(supplier, supplierOrders);
      save(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        supplierWorkbookFilename(supplier),
      );
      markExported(supplierOrders.map((order) => order.id));
      set({ toast: `Excel для ${supplier} сформирован.` });
    } catch (error) {
      console.error(`Failed to export supplier workbook for ${supplier}`, error);
      set({ toast: `Не удалось сформировать Excel для ${supplier}. Повторите выгрузку.` });
    } finally {
      setBusy('');
    }
  }

  function editOrder(skuCode: string, branch: string, qty: number, orderId: string) {
    set({
      edits: [
        ...state.edits.filter(
          (edit) => edit.skuCode !== skuCode || edit.branch !== branch,
        ),
        { skuCode, branch, qty },
      ],
      exportedOrderIds: (state.exportedOrderIds ?? []).filter((id) => id !== orderId),
      toast: 'Количество и сумма заказа пересчитаны.',
    });
  }

  function exportSingle(order: Order, allowBelowThreshold: boolean) {
    const hardBlockers = order.blockers.filter(
      (blocker) => blocker !== 'Ниже минимальной суммы',
    );
    if (hardBlockers.length > 0) {
      set({ toast: `Экспорт невозможен: ${hardBlockers.join(', ')}.` });
      return;
    }
    if (order.belowThreshold && !allowBelowThreshold) return;

    try {
      downloadCsv(order);
      markExported([order.id]);
      set({ toast: `CSV заказа ${order.branch} → ${order.supplier} сформирован.` });
    } catch (error) {
      console.error(`Failed to export CSV for order ${order.id}`, error);
      set({ toast: 'Не удалось сформировать CSV заказа. Повторите выгрузку.' });
    }
  }

  return (
    <main>
      <header className="header-actions">
        <div>
          <p className="eyebrow">Шаг 4 из 4</p>
          <h1>Заказы</h1>
          <p>Каждая ячейка — отдельный заказ подразделения конкретному поставщику.</p>
        </div>
        <Button disabled={exportable.length === 0 || Boolean(busy)} onClick={zip}>
          {busy || `Скачать все CSV (${exportable.length})`}
        </Button>
      </header>

      <ThresholdControls
        settings={state.settings}
        onChange={(settings) => set({ settings, toast: 'Порог закупки пересчитан.' })}
        showBelowThreshold={showBelowThreshold}
        onShowBelowThresholdChange={setShowBelowThreshold}
      />

      <section className="filters compact-filters">
        <label>
          Поиск поставщика
          <Input
            value={supplierQuery}
            onChange={(event) => setSupplierQuery(event.target.value)}
            placeholder="Название поставщика"
          />
        </label>
        <span>
          В матрице: <strong>{visibleOrders.length}</strong> заказов
        </span>
        {supplierQuery && (
          <button className="link" onClick={() => setSupplierQuery('')}>
            Сбросить поиск
          </button>
        )}
      </section>

      <div className="metrics">
        <MetricCard
          label="Готовы"
          value={orders.filter((order) => order.status === 'READY').length}
        />
        <MetricCard
          label="Выгружены"
          value={orders.filter((order) => order.status === 'EXPORTED').length}
        />
        <MetricCard
          label="Заблокированы"
          value={orders.filter((order) => order.status === 'BLOCKED').length}
        />
        <MetricCard label="Требуют поставщика" value={derived.projection.unassigned.length} />
      </div>

      {derived.projection.unassigned.length > 0 && (
        <Alert tone="danger">
          Не выбран поставщик для {derived.projection.unassigned.length} строк потребности.
          Перейдите в «Поставщики» и разрешите их до финальной выгрузки.
        </Alert>
      )}

      {visibleOrders.length > 0 ? (
        <div className="table-wrap matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>Поставщик</th>
                {branches.map((branch) => (
                  <th key={branch}>{branch}</th>
                ))}
                <th>Итого поставщику</th>
                <th>Excel</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => {
                const allSupplierOrders = orders.filter(
                  (order) => order.supplier === supplier,
                );
                const supplierTotal = summarizeOrders(allSupplierOrders);
                const hidden = allSupplierOrders.filter(
                  (order) => !visibleOrders.some((visible) => visible.id === order.id),
                ).length;
                return (
                  <tr key={supplier}>
                    <th>{supplier}</th>
                    {branches.map((branch) => {
                      const order = visibleOrders.find(
                        (item) => item.supplier === supplier && item.branch === branch,
                      );
                      return (
                        <td key={branch}>
                          {order && (
                            <button
                              className={`order-cell ${order.status} ${order.belowThreshold ? 'below-threshold' : ''}`}
                              onClick={() => setSelectedId(order.id)}
                            >
                              <strong>
                                {order.totalAmount == null
                                  ? 'Сумма неизвестна'
                                  : money(order.totalAmount)}
                              </strong>
                              <span>
                                {order.lines.filter((line) => line.orderQty > 0).length} SKU ·{' '}
                                {order.status === 'READY'
                                  ? 'Готов'
                                  : order.status === 'EXPORTED'
                                    ? 'Выгружен'
                                    : 'Заблокирован'}
                              </span>
                              {order.blockers.map((blocker) => (
                                <small key={blocker}>{blocker}</small>
                              ))}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="supplier-total-cell">
                      <strong>
                        {supplierTotal.amount == null
                          ? 'Сумма неизвестна'
                          : money(supplierTotal.amount)}
                      </strong>
                      <small>
                        {fmtQty(supplierTotal.qty)} ед. · {allSupplierOrders.length} заказов
                      </small>
                      {hidden > 0 && <small>Скрыто порогом: {hidden}</small>}
                    </td>
                    <td>
                      <Button
                        className="secondary"
                        disabled={
                          !visibleOrders.some(
                            (order) =>
                              order.supplier === supplier &&
                              (order.status === 'READY' || order.status === 'EXPORTED'),
                          ) || Boolean(busy)
                        }
                        onClick={() => excel(supplier)}
                      >
                        Excel
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Нет заказов, соответствующих текущему порогу и фильтрам.</EmptyState>
      )}

      {selected && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onEdit={(skuCode, branch, qty) =>
            editOrder(skuCode, branch, qty, selected.id)
          }
          onExport={(allowBelowThreshold) => exportSingle(selected, allowBelowThreshold)}
        />
      )}
    </main>
  );
}

function hasHardBlocker(order: Order) {
  return order.blockers.some((blocker) => blocker !== 'Ниже минимальной суммы');
}

function summarizeOrders(orders: Order[]) {
  const positiveLines = orders.flatMap((order) =>
    order.lines.filter((line) => line.orderQty > 0),
  );
  const missing = positiveLines.some((line) => line.amount == null);
  return {
    qty: positiveLines.reduce((sum, line) => sum + line.orderQty, 0),
    amount: missing
      ? null
      : positiveLines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
  };
}
