import { moneySum } from '../../domain/money';
import type { OrderLine } from '../../domain/types';
import { useMemo, useState } from 'react';
import { orderToCsv } from '../../export/csv';
import { canReconcileOrder } from '../../app/invoiceOrders';
import { useStore } from '../../app/appStore';
import { derive, type WorkflowOrder } from '../../app/selectors';
import { useDerivedState } from '../../app/useDerivedState';
import { usePreference } from '../../app/usePreference';
import { QuantitySummary } from '../../components/QuantitySummary';
import { PurchasingDataAlert } from '../../components/PurchasingDataAlert';
import { MovementIndicator } from '../rebalancing/AcceptedMovementsPopover';
import { ThresholdControls } from '../../components/ThresholdControls';
import {
  Alert,
  Button,
  EmptyState,
  SearchInput,
  MetricCard,
} from '../../components/ui';
import {
  applyOrderQtyChange,
  setOrderReviewed,
  setOrdersReviewed,
} from '../../domain/orderWorkflow';
import {
  downloadCsv,
  downloadReadyOrdersZip,
  save,
} from '../../export/download';
import { supplierWorkbookFilename } from '../../export/orderFilenames';
import { buildSupplierWorkbook } from '../../export/supplierWorkbook';
import { money } from '../../format/numbers';
import { readActiveWorkspaceRevision } from '../../persistence/workspaces';
import { OrderDrawer } from './OrderDrawer';
import { SupplierOrdersDrawer } from './SupplierOrdersDrawer';

type ExportMode = 'ALL' | 'REVIEWED';

const staleExportMessage =
  'Рабочий сеанс изменился. Обновите страницу и повторите выгрузку.';

class StaleOrderExportError extends Error {}

function renderOrderMovement(line: OrderLine) {
  const transferCount = line.purchaseContext?.acceptedTransferIds.length;
  if (!transferCount) return null;
  return (
    <MovementIndicator
      scope={{ skuCode: line.skuCode, branch: line.branch }}
      manualOrderQty={
        line.orderQty !== line.calculatedQty ? line.orderQty : undefined
      }
      transferCount={transferCount}
    />
  );
}

export function OrdersPage({
  onReconcile,
}: { onReconcile?: (orderIds: string[]) => void } = {}) {
  const { state, set, commit, saving } = useStore();
  const derived = useDerivedState(state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [exportError, setExportError] = useState('');
  const [supplierQuery, setSupplierQuery] = usePreference('orders:query', '');
  const [showBelowThreshold, setShowBelowThreshold] = usePreference(
    'orders:belowThreshold',
    false,
  );

  const orders = derived.projection.orders;
  const visibleOrders = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase('ru-RU');
    return orders.filter((order) => {
      if (query && !order.supplier.toLocaleLowerCase('ru-RU').includes(query)) {
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
    ? (orders.find((order) => order.id === selectedId) ?? null)
    : null;
  const selectedSupplierOrders = selectedSupplier
    ? (ordersBySupplier.get(selectedSupplier) ?? [])
    : [];

  const exportedIds = new Set(state.exportedOrderIds);
  const eligibleSupplierOrderIds = onReconcile
    ? selectedSupplierOrders
      .filter((order) => canReconcileOrder(order, exportedIds.has(order.id)))
      .map((order) => order.id)
    : [];

  async function verifyExportRevision(): Promise<void> {
    if (!commit) return;
    const active = await readActiveWorkspaceRevision();
    if (
      active?.workspaceId !== state.workspaceId ||
      active.revision !== state.workspaceRevision
    ) {
      throw new StaleOrderExportError(staleExportMessage);
    }
  }

  function reportExportError(error: unknown, message: string) {
    const detail = error instanceof StaleOrderExportError ? error.message : message;
    setExportError(detail);
    set({ toast: detail });
  }

  const markExported = async (
    exported: WorkflowOrder[],
    allowBelowThreshold = false,
  ) => {
    const payloads = new Map(exported.map((o) => [o.id, orderToCsv(o)]));
    const patch = (current: typeof state) => {
      if (
        current.workspaceId !== state.workspaceId ||
        current.snapshotId !== state.snapshotId
      )
        return {};
      const ids = derive(current)
        .projection.orders.filter(
          (o) =>
            payloads.has(o.id) &&
            !hasHardBlocker(o) &&
            (!o.belowThreshold || allowBelowThreshold) &&
            payloads.get(o.id) === orderToCsv(o),
        )
        .map((o) => o.id);
      return {
        exportedOrderIds: [...new Set([...current.exportedOrderIds, ...ids])],
      };
    };
    if (commit) await commit(patch);
    else set(patch);
  };

  async function zip(mode: ExportMode) {
    const target = mode === 'REVIEWED' ? reviewedExportable : exportable;
    if (target.length === 0) return;
    setExportError('');
    setBusy(`Формирование ${target.length} CSV…`);
    try {
      await downloadReadyOrdersZip(target, verifyExportRevision);
      await markExported(target);
      set({
        toast:
          mode === 'REVIEWED'
            ? `Создан ZIP проверенных заказов: ${target.length} CSV.`
            : `Создан ZIP: ${target.length} CSV.`,
      });
    } catch (error) {
      if (!(error instanceof StaleOrderExportError))
        console.error('Failed to export orders ZIP', error);
      reportExportError(
        error,
        'Не удалось сформировать ZIP с заказами. Повторите выгрузку.',
      );
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
    setExportError('');
    setBusy(`Создание Excel для ${supplier}…`);
    try {
      const buffer = await buildSupplierWorkbook(supplier, supplierOrders, mode);
      await verifyExportRevision();
      save(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        supplierWorkbookFilename(supplier),
      );
      await markExported(supplierOrders);
      set({
        toast:
          mode === 'REVIEWED'
            ? `Excel проверенных заказов для ${supplier} сформирован.`
            : `Excel для ${supplier} сформирован.`,
      });
    } catch (error) {
      if (!(error instanceof StaleOrderExportError))
        console.error(`Failed to export supplier workbook for ${supplier}`, error);
      reportExportError(
        error,
        `Не удалось сформировать Excel для ${supplier}. Повторите выгрузку.`,
      );
    } finally {
      setBusy('');
    }
  }

  async function editOrder(
    order: WorkflowOrder,
    skuCode: string,
    qty: number,
  ): Promise<void> {
    try {
      const currentLine = order.lines.find((line) => line.skuCode === skuCode);
      if (!commit && currentLine?.orderQty === qty) {
        return;
      }
      const patch = (s: typeof state) => {
        const current = derive(s).projection.orders.find(
          (o) => o.id === order.id,
        );
        if (!current) throw new Error('Заказ изменился. Откройте его заново.');
        if (
          current.lines.find((line) => line.skuCode === skuCode)?.orderQty ===
          qty
        )
          return {};
        return {
          ...applyOrderQtyChange({
            edits: s.edits,
            reviewedOrderIds: s.reviewedOrderIds,
            exportedOrderIds: s.exportedOrderIds,
            order: current,
            skuCode,
            qty,
          }),
        };
      };
      if (commit) await commit(patch);
      else set(patch);
    } catch (error) {
      console.error('Failed to edit order quantity', error);
      set({ toast: 'Не удалось изменить количество в заказе.' });
      throw error;
    }
  }

  function setReviewed(orderId: string, reviewed: boolean): void {
    set((current) => ({
      reviewedOrderIds: setOrderReviewed(
        current.reviewedOrderIds,
        orderId,
        reviewed,
      ),
      toast: reviewed ? 'Заказ отмечен проверенным.' : 'Проверка заказа снята.',
    }));
  }

  function setAllReviewed(orderIds: string[], reviewed: boolean): void {
    set((current) => ({
      reviewedOrderIds: setOrdersReviewed(
        current.reviewedOrderIds,
        orderIds,
        reviewed,
      ),
      toast: reviewed
        ? `Проверены заказы: ${orderIds.length}.`
        : `Проверка снята: ${orderIds.length}.`,
    }));
  }

  async function exportSingle(
    order: WorkflowOrder,
    allowBelowThreshold: boolean,
  ) {
    setExportError('');
    const hardBlockers = order.blockers.filter(
      (blocker) => blocker !== 'Ниже минимальной суммы',
    );
    if (hardBlockers.length > 0) {
      set({ toast: `Экспорт невозможен: ${hardBlockers.join(', ')}.` });
      return;
    }
    if (order.belowThreshold && !allowBelowThreshold) return;

    setBusy('Формирование CSV…');
    try {
      await verifyExportRevision();
      downloadCsv(order);
      await markExported([order], allowBelowThreshold);
      set({
        toast: `CSV заказа ${order.branch} → ${order.supplier} сформирован.`,
      });
    } catch (error) {
      if (!(error instanceof StaleOrderExportError))
        console.error(`Failed to export CSV for order ${order.id}`, error);
      reportExportError(
        error,
        'Не удалось сформировать CSV заказа. Повторите выгрузку.',
      );
    } finally {
      setBusy('');
    }
  }

  return (
    <main>
      <header className="header-actions">
        <div>
          <p className="eyebrow">Рабочая потребность</p>
          <h1>Заказы</h1>
          <p>
            Каждая ячейка — отдельный заказ подразделения конкретному
            поставщику.
          </p>
        </div>
        <div className="export-actions">
          <Button
            disabled={exportable.length === 0 || Boolean(busy || saving)}
            onClick={() => zip('ALL')}
          >
            {busy || `Скачать все (${exportable.length})`}
          </Button>
          <Button
            className="secondary"
            disabled={
              reviewedExportable.length === 0 || Boolean(busy || saving)
            }
            onClick={() => zip('REVIEWED')}
          >
            Скачать проверенные ({reviewedExportable.length})
          </Button>
        </div>
      </header>
      <PurchasingDataAlert issues={derived.projection.dataIssues} />
      {exportError && <Alert tone="danger">{exportError}</Alert>}

      <ThresholdControls
        settings={state.settings}
        onChange={async (settings) => {
          const patch = { settings };
          if (commit) await commit(patch);
          else set(patch);
        }}
        showBelowThreshold={showBelowThreshold}
        onShowBelowThresholdChange={setShowBelowThreshold}
      />

      <section className="filters compact-filters">
        <label>
          Поиск поставщика
          <SearchInput
            value={supplierQuery}
            onValueChange={setSupplierQuery}
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
          icon="cart"
          tone="accent"
          value={orders.filter((order) => order.status === 'READY').length}
        />
        <MetricCard
          label="Проверены"
          icon="check"
          tone="success"
          value={orders.filter((order) => order.reviewed).length}
        />
        <MetricCard
          label="Выгружены"
          icon="download"
          tone="neutral"
          value={orders.filter((order) => exportedIds.has(order.id)).length}
        />
        <MetricCard
          label="Заблокированы"
          icon="warning"
          tone="warning"
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
                  (order) => !visibleOrderIds.has(order.id),
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
                const supplierHasBlocker =
                  allSupplierOrders.some(hasHardBlocker);
                const supplierReviewed =
                  allSupplierOrders.length > 0 &&
                  reviewedCount === allSupplierOrders.length &&
                  !supplierHasBlocker;

                return (
                  <tr key={supplier}>
                    <th className="supplier-card-cell">
                      <button
                        className={`supplier-card ${
                          supplierReviewed ? 'is-reviewed' : ''
                        } ${supplierHasBlocker ? 'has-blocker' : ''}`}
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
                          {pluralize(allSupplierOrders.length, [
                            'подразделение',
                            'подразделения',
                            'подразделений',
                          ])}{' '}
                          · {supplierSkuCount} SKU ·{' '}
                          <QuantitySummary
                            rows={allSupplierOrders.flatMap((order) =>
                              order.lines.map((line) => ({
                                skuCode: line.skuCode,
                                qty: line.orderQty,
                                unit: line.unit,
                              })),
                            )}
                          />
                        </small>
                        <span className="order-status-line">
                          <small>
                            {supplierReviewed
                              ? `✓ Все ${allSupplierOrders.length} ${pluralize(
                                  allSupplierOrders.length,
                                  [
                                    'заказ проверен',
                                    'заказа проверены',
                                    'заказов проверены',
                                  ],
                                )}`
                              : `✓ ${reviewedCount} из ${allSupplierOrders.length} проверено`}
                          </small>
                          {manualEditCount > 0 && (
                            <small className="manual-indicator">
                              ✋ {manualEditCount}
                            </small>
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
                            className={`order-cell ${order.status} ${
                              order.belowThreshold ? 'below-threshold' : ''
                            } ${
                              order.reviewed && !hardBlocked
                                ? 'reviewed is-reviewed'
                                : ''
                            } ${hardBlocked ? 'has-blocker' : ''} ${
                              order.manualEditCount > 0 ? 'manual-edited' : ''
                            }`}
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
                            {order.status === 'BLOCKED' &&
                              exportedIds.has(order.id) && (
                                <span className="badge OK">Выгружен</span>
                              )}
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
                            supplierExportable.length === 0 ||
                            Boolean(busy || saving)
                          }
                          onClick={() => excel(supplier, 'ALL')}
                        >
                          Excel все
                        </Button>
                        <Button
                          className="secondary"
                          disabled={
                            supplierReviewedExportable.length === 0 ||
                            Boolean(busy || saving)
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
          exported={exportedIds.has(selected.id)}
          exportError={exportError}
          saving={Boolean(busy || saving)}
          renderMovement={renderOrderMovement}
          onClose={() => setSelectedId(null)}
          onEdit={(skuCode, _branch, qty) => editOrder(selected, skuCode, qty)}
          onReviewedChange={(reviewed) => setReviewed(selected.id, reviewed)}
          onReconcile={
            onReconcile && canReconcileOrder(selected, exportedIds.has(selected.id))
              ? () => onReconcile([selected.id])
              : undefined
          }
          onExport={(allowBelowThreshold) =>
            exportSingle(selected, allowBelowThreshold)
          }
        />
      )}

      {selectedSupplier && selectedSupplierOrders.length > 0 && (
        <SupplierOrdersDrawer
          supplier={selectedSupplier}
          saving={Boolean(busy || saving)}
          renderMovement={renderOrderMovement}
          orders={selectedSupplierOrders}
          exportedOrderIds={exportedIds}
          branchOrder={branches}
          widthPreferences={
            state.uiPreferences.supplierMatrixWidths as
              | Record<string, number>
              | undefined
          }
          onWidthsChange={(supplierMatrixWidths) =>
            set((s) => ({
              uiPreferences: { ...s.uiPreferences, supplierMatrixWidths },
            }))
          }
          onClose={() => setSelectedSupplier(null)}
          onEdit={editOrder}
          onSetReviewed={setReviewed}
          onSetAllReviewed={setAllReviewed}
          onReconcile={
            onReconcile && eligibleSupplierOrderIds.length
              ? () => onReconcile(eligibleSupplierOrderIds)
              : undefined
          }
        />
      )}
    </main>
  );
}

function isExportable(order: WorkflowOrder): boolean {
  return order.status === 'READY' || order.status === 'EXPORTED';
}

function hasHardBlocker(order: WorkflowOrder): boolean {
  return order.blockers.some((blocker) => blocker !== 'Ниже минимальной суммы');
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
      : moneySum(positiveLines.map((line) => line.amount ?? 0)),
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
