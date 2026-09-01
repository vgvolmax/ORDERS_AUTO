import { useMemo, useState } from 'react';
import { useStore } from '../../app/appStore';
import { derive, type WorkflowOrder } from '../../app/selectors';
import { ThresholdControls } from '../../components/ThresholdControls';
import { Alert, Button, EmptyState, Input, MetricCard } from '../../components/ui';
import {
  applyOrderQtyChange,
  setOrderReviewed,
  setOrdersReviewed,
} from '../../domain/orderWorkflow';
import { downloadCsv, downloadReadyOrdersZip, save } from '../../export/download';
import { supplierWorkbookFilename } from '../../export/orderFilenames';
import { buildSupplierWorkbook } from '../../export/supplierWorkbook';
import { fmtQty, money } from '../demand/DemandPage';
import { OrderDrawer } from './OrderDrawer';
import { SupplierOrdersDrawer } from './SupplierOrdersDrawer';

type ExportMode = 'ALL' | 'REVIEWED';

export function OrdersPage() {
  const { state, set } = useStore();
  const derived = derive(state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [supplierQuery, setSupplierQuery] = useState('');
  const [showBelowThreshold, setShowBelowThreshold] = useState(false);

  const orders = derived.projection.orders;
  const visibleOrders = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase('ru-RU');
    return orders.filter((order) => {
      if (
        query &&
        !order.supplier.toLocaleLowerCase('ru-RU').includes(query)
      ) {
        return false;
      }
      if (
        !showBelowThreshold &&
        order.belowThreshold &&
        !hasHardBlocker(order)
      ) {
        return false;
      }
      return true;
    });
  }, [orders, supplierQuery, showBelowThreshold]);

  const ordersBySupplier = useMemo(() => {
    const index = new Map<string, WorkflowOrder[]>();
    for (const order of orders) {
      const supplierOrders = index.get(order.supplier) ?? [];
      supplierOrders.push(order);
      index.set(order.supplier, supplierOrders);
    }
    return index;
  }, [orders]);
  const visibleOrderBySupplierBranch = useMemo(
    () =>
      new Map(
        visibleOrders.map((order) => [
          `${order.supplier}\0${order.branch}`,
          order,
        ]),
      ),
    [visibleOrders],
  );
  const visibleOrderIds = useMemo(
    () => new Set(visibleOrders.map((order) => order.id)),
    [visibleOrders],
  );

  // Global export actions always operate on the application projection. Search
  // and row-visibility controls are presentation filters only.
  const exportable = orders.filter(isExportable);
  const reviewedExportable = exportable.filter((order) => order.reviewed);
  const suppliers = [...new Set(visibleOrders.map((order) => order.supplier))];
  const branches = state.minMax!.branches;
  const selected = selectedId
    ? orders.find((order) => order.id === selectedId) ?? null
    : null;
  const selectedSupplierOrders = selectedSupplier
    ? ordersBySupplier.get(selectedSupplier) ?? []
    : [];

  const markExported = (ids: string[]) => {
    set({
      exportedOrderIds: [
        ...new Set([...(state.exportedOrderIds ?? []), ...ids]),
      ],
    });
  };

  async function zip(mode: ExportMode) {
    const target = mode === 'REVIEWED' ? reviewedExportable : exportable;
    if (target.length === 0) return;
    setBusy(`Формирование ${target.length} CSV…`);
    try {
      await downloadReadyOrdersZip(target);
      markExported(target.map((order) => order.id));
      set({
        toast:
          mode === 'REVIEWED'
            ? `Создан ZIP проверенных заказов: ${target.length} CSV.`
            : `Создан ZIP: ${target.length} CSV.`,
      });
    } catch (error) {
      console.error('Failed to export orders ZIP', error);
      set({
        toast: 'Не удалось сформировать ZIP с заказами. Повторите выгрузку.',
      });
    } finally {
      setBusy('');
    }
  }

  async function excel(supplier: string, mode: ExportMode) {
    const supplierOrders = orders.filter(
      (order) =>
        order.supplier === supplier &&
        isExportable(order) &&
        (mode === 'ALL' || order.reviewed),
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
      set({
        toast:
          mode === 'REVIEWED'
            ? `Excel проверенных заказов для ${supplier} сформирован.`
            : `Excel для ${supplier} сформирован.`,
      });
    } catch (error) {
      console.error(`Failed to export supplier workbook for ${supplier}`, error);
      set({
        toast: `Не удалось сформировать Excel для ${supplier}. Повторите выгрузку.`,
      });
    } finally {
      setBusy('');
    }
  }

  function editOrder(
    order: WorkflowOrder,
    skuCode: string,
    qty: number,
  ): void {
    try {
      const currentLine = order.lines.find((line) => line.skuCode === skuCode);
      if (currentLine?.orderQty === qty) {
        set({ toast: 'Количество не изменилось.' });
        return;
      }
      const next = applyOrderQtyChange({
        edits: state.edits,
        reviewedOrderIds: state.reviewedOrderIds,
        exportedOrderIds: state.exportedOrderIds,
        order,
        skuCode,
        qty,
      });
      set({
        ...next,
        toast: 'Количество и сумма заказа пересчитаны. Проверка заказа снята.',
      });
    } catch (error) {
      console.error('Failed to edit order quantity', error);
      set({ toast: 'Не удалось изменить количество в заказе.' });
    }
  }

  function setReviewed(orderId: string, reviewed: boolean): void {
    set({
      reviewedOrderIds: setOrderReviewed(
        state.reviewedOrderIds,
        orderId,
        reviewed,
      ),
      toast: reviewed ? 'Заказ отмечен проверенным.' : 'Проверка заказа снята.',
    });
  }

  function setAllReviewed(orderIds: string[], reviewed: boolean): void {
    set({
      reviewedOrderIds: setOrdersReviewed(
        state.reviewedOrderIds,
        orderIds,
        reviewed,
      ),
      toast: reviewed
        ? `Проверены заказы: ${orderIds.length}.`
        : `Проверка снята: ${orderIds.length}.`,
    });
  }

  function exportSingle(order: WorkflowOrder, allowBelowThreshold: boolean) {
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
      set({
        toast: `CSV заказа ${order.branch} → ${order.supplier} сформирован.`,
      });
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
          <p>
            Каждая ячейка — отдельный заказ подразделения конкретному поставщику.
          </p>
        </div>
        <div className="export-actions">
          <Button
            disabled={exportable.length === 0 || Boolean(busy)}
            onClick={() => zip('ALL')}
          >
            {busy || `Скачать все (${exportable.length})`}
          </Button>
          <Button
            className="secondary"
            disabled={reviewedExportable.length === 0 || Boolean(busy)}
            onClick={() => zip('REVIEWED')}
          >
            Скачать проверенные ({reviewedExportable.length})
          </Button>
        </div>
      </header>

      <ThresholdControls
        settings={state.settings}
        onChange={(settings) =>
          set({ settings, toast: 'Порог закупки пересчитан.' })
        }
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
          label="Проверены"
          value={orders.filter((order) => order.reviewed).length}
        />
        <MetricCard
          label="Выгружены"
          value={orders.filter((order) => order.status === 'EXPORTED').length}
        />
        <MetricCard
          label="Заблокированы"
          value={orders.filter((order) => order.status === 'BLOCKED').length}
        />
      </div>

      {derived.projection.unassigned.length > 0 && (
        <Alert tone="danger">
          Не выбран поставщик для {derived.projection.unassigned.length} строк
          потребности. Перейдите в «Поставщики» и разрешите их до финальной
          выгрузки.
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
                <th>Excel</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => {
                const allSupplierOrders = ordersBySupplier.get(supplier) ?? [];
                const supplierTotal = summarizeOrders(allSupplierOrders);
                const reviewedCount = allSupplierOrders.filter(
                  (order) => order.reviewed && !hasHardBlocker(order),
                ).length;
                const manualEditCount = allSupplierOrders.reduce(
                  (sum, order) => sum + order.manualEditCount,
                  0,
                );
                const hidden = allSupplierOrders.filter(
                  (order) =>
                    !visibleOrderIds.has(order.id),
                ).length;
                const supplierExportable = allSupplierOrders.filter(
                  (order) => order.supplier === supplier && isExportable(order),
                );
                const supplierReviewedExportable = supplierExportable.filter(
                  (order) => order.reviewed,
                );
                const supplierSkuCount = new Set(
                  allSupplierOrders.flatMap((order) =>
                    order.lines
                      .filter((line) => line.orderQty > 0)
                      .map((line) => line.skuCode),
                  ),
                ).size;
                const supplierHasBlocker = allSupplierOrders.some(hasHardBlocker);
                const supplierReviewed =
                  allSupplierOrders.length > 0 &&
                  reviewedCount === allSupplierOrders.length &&
                  !supplierHasBlocker;

                return (
                  <tr key={supplier}>
                    <th className="supplier-card-cell">
                      <button
                        className={`supplier-card ${supplierReviewed ? 'is-reviewed' : ''} ${supplierHasBlocker ? 'has-blocker' : ''}`}
                        aria-label={`Все заказы ${supplier}`}
                        onClick={() => setSelectedSupplier(supplier)}
                      >
                        <span className="supplier-name">{supplier}</span>
                        <strong>
                          {supplierTotal.amount == null
                            ? 'Сумма неизвестна'
                            : money(supplierTotal.amount)}
                        </strong>
                        <small>
                          {allSupplierOrders.length}{' '}
                          {pluralize(allSupplierOrders.length, ['подразделение', 'подразделения', 'подразделений'])} ·{' '}
                          {supplierSkuCount} SKU · {fmtQty(supplierTotal.qty)} ед.
                        </small>
                        <span className="order-status-line">
                          <small>
                            {supplierReviewed
                              ? `✓ Все ${allSupplierOrders.length} ${pluralize(allSupplierOrders.length, ['заказ проверен', 'заказа проверены', 'заказов проверены'])}`
                              : `✓ ${reviewedCount} из ${allSupplierOrders.length} проверено`}
                          </small>
                          {manualEditCount > 0 && (
                            <small className="manual-indicator">✋ {manualEditCount}</small>
                          )}
                        </span>
                        {hidden > 0 && <small>Скрыто порогом: {hidden}</small>}
                      </button>
                    </th>
                    {branches.map((branch) => {
                      const order = visibleOrderBySupplierBranch.get(
                        `${supplier}\0${branch}`,
                      );
                      if (!order) {
                        return <td key={branch} />;
                      }
                      const hardBlocked = hasHardBlocker(order);
                      return (
                        <td key={branch}>
                          <button
                            className={`order-cell ${order.status} ${order.belowThreshold ? 'below-threshold' : ''} ${order.reviewed && !hardBlocked ? 'reviewed is-reviewed' : ''} ${hardBlocked ? 'has-blocker' : ''} ${order.manualEditCount > 0 ? 'manual-edited' : ''}`}
                            onClick={() => setSelectedId(order.id)}
                          >
                            <span className="order-status-line">
                              {order.reviewed && (
                                <span aria-label="Проверен" title="Проверен">
                                  ✓
                                </span>
                              )}
                              {order.manualEditCount > 0 && (
                                <span
                                  aria-label={`Изменено вручную ${order.manualEditCount}`}
                                  title="Количество изменено вручную"
                                >
                                  ✋ {order.manualEditCount}
                                </span>
                              )}
                            </span>
                            <strong>
                              {order.totalAmount == null
                                ? 'Сумма неизвестна'
                                : money(order.totalAmount)}
                            </strong>
                            <span>
                              {
                                order.lines.filter((line) => line.orderQty > 0)
                                  .length
                              }{' '}
                              SKU ·{' '}
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
                        </td>
                      );
                    })}
                    <td>
                      <div className="supplier-export-actions">
                        <Button
                          className="secondary"
                          disabled={
                            supplierExportable.length === 0 || Boolean(busy)
                          }
                          onClick={() => excel(supplier, 'ALL')}
                        >
                          Excel все
                        </Button>
                        <Button
                          className="secondary"
                          disabled={
                            supplierReviewedExportable.length === 0 ||
                            Boolean(busy)
                          }
                          onClick={() => excel(supplier, 'REVIEWED')}
                        >
                          Проверенные {supplierReviewedExportable.length}/
                          {supplierExportable.length}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          Нет заказов, соответствующих текущему порогу и фильтрам.
        </EmptyState>
      )}

      {selected && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onEdit={(skuCode, _branch, qty) => editOrder(selected, skuCode, qty)}
          onReviewedChange={(reviewed) => setReviewed(selected.id, reviewed)}
          onExport={(allowBelowThreshold) =>
            exportSingle(selected, allowBelowThreshold)
          }
        />
      )}

      {selectedSupplier && selectedSupplierOrders.length > 0 && (
        <SupplierOrdersDrawer
          supplier={selectedSupplier}
          orders={selectedSupplierOrders}
          branchOrder={branches}
          onClose={() => setSelectedSupplier(null)}
          onEdit={editOrder}
          onSetReviewed={setReviewed}
          onSetAllReviewed={setAllReviewed}
        />
      )}
    </main>
  );
}

function isExportable(order: WorkflowOrder): boolean {
  return order.status === 'READY' || order.status === 'EXPORTED';
}

function hasHardBlocker(order: WorkflowOrder): boolean {
  return order.blockers.some(
    (blocker) => blocker !== 'Ниже минимальной суммы',
  );
}

function summarizeOrders(orders: WorkflowOrder[]) {
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

function pluralize(count: number, forms: [string, string, string]): string {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  if (modulo100 >= 11 && modulo100 <= 14) return forms[2];
  if (modulo10 === 1) return forms[0];
  if (modulo10 >= 2 && modulo10 <= 4) return forms[1];
  return forms[2];
}
