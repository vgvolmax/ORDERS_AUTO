import { moneySum } from '../../domain/money';
import type { OrderLine } from '../../domain/types';
import { WorkspaceConflictError } from '../../domain/workspace';
import { useMemo, useState } from 'react';
import { orderToCsv } from '../../export/csv';
import { canReconcileOrder } from '../../app/invoiceOrders';
import { useStore } from '../../app/appStore';
import { derive, type WorkflowOrder } from '../../app/selectors';
import { useDerivedState } from '../../app/useDerivedState';
import { usePreference } from '../../app/usePreference';
import { Dialog } from '../../components/Dialog';
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
  applyOrderSkuExclusion,
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
import { checkOrderLines, checkOrderReview } from './orderCollaboration';
import { SupplierOrdersDrawer } from './SupplierOrdersDrawer';

type ExportMode = 'ALL' | 'REVIEWED';
type ExportRecord = { orders: WorkflowOrder[]; allowBelowThreshold: boolean; time: string };
type Exclusion = { orderIds: string[]; skuCode: string; excluded: boolean };

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
  const [pendingExport, setPendingExport] = useState<ExportRecord | null>(null);
  const [orderError, setOrderError] = useState('');
  const [exclusion, setExclusion] = useState<Exclusion | null>(null);
  const [reviewOnly, setReviewOnly] = usePreference('orders:reviewOnly', false);
  const [affected, setAffected] = usePreference<string[]>('orders:affected', []);
  const [supplierQuery, setSupplierQuery] = usePreference('orders:query', '');
  const [showBelowThreshold, setShowBelowThreshold] = usePreference(
    'orders:belowThreshold',
    false,
  );

  const orders = derived.projection.orders;
  const matchingOrders = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase('ru-RU');
    const affectedIds = new Set(affected);
    return orders.filter((order) => {
      if (affectedIds.size && !affectedIds.has(order.id)) return false;
      if (reviewOnly && (order.reviewed || hasHardBlocker(order))) return false;
      if (query && !order.supplier.toLocaleLowerCase('ru-RU').includes(query)) {
        return false;
      }
      return true;
    });
  }, [orders, supplierQuery, reviewOnly, affected]);
  const visibleOrders = useMemo(() => showBelowThreshold ? matchingOrders
    : matchingOrders.filter((order) => !order.belowThreshold || hasHardBlocker(order)),
  [matchingOrders, showBelowThreshold]);
  const hiddenBelowThreshold = matchingOrders.length - visibleOrders.length;

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
  const savedExports = new Map((state.exportedOrders ?? []).map((order) => [order.id, order]));
  const visibleReviewIds = visibleOrders.filter((order) => !order.reviewed && !hasHardBlocker(order)).map(({ id }) => id);
  const nextReviewId = selected && orders.slice(orders.indexOf(selected) + 1).find((order) =>
    visibleOrderIds.has(order.id) && !order.reviewed && !hasHardBlocker(order),
  )?.id;
  const thresholdAmount = selected?.belowThreshold && state.settings.thresholdMode === 'SUPPLIER_TOTAL'
    ? summarizeOrders((ordersBySupplier.get(selected.supplier) ?? []).filter((order) => !hasHardBlocker(order))).amount
    : selected?.totalAmount;
  const exclusionTargets = exclusion ? orders.filter(({ id }) => exclusion.orderIds.includes(id)) : [];
  const exclusionChecks = exclusionTargets.filter(({ reviewed }) => reviewed).length;
  const exclusionRemovedAmounts = exclusionTargets.flatMap((order) =>
    order.lines.filter((line) => line.skuCode === exclusion?.skuCode && line.orderQty > 0).map(({ amount }) => amount),
  );
  const exportRecovery = pendingExport && (
    <Alert tone="warning">
      Скачивание запущено. Версия выгрузки не записалась в сеанс.{' '}
      <Button className="secondary" disabled={Boolean(busy || saving)} onClick={() => void retryExportRecord()}>
        Повторить запись отметки
      </Button>
    </Alert>
  );
  const eligibleSupplierOrderIds = onReconcile
    ? selectedSupplierOrders
      .filter((order) => canReconcileOrder(order, exportedIds.has(order.id)) || savedExports.has(order.id))
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

  const markExported = async ({ orders: exported, allowBelowThreshold, time }: ExportRecord) => {
    const payloads = new Map(exported.map((o) => [o.id, orderToCsv(o)]));
    const patch = (current: typeof state) => {
      if (
        current.workspaceId !== state.workspaceId ||
        current.snapshotId !== state.snapshotId
      )
        throw new StaleOrderExportError('Активный сеанс сменился. Отметка о выгрузке не записана.');
      const ids = derive(current)
        .projection.orders.filter(
          (o) =>
            payloads.has(o.id) &&
            !hasHardBlocker(o) &&
            (!o.belowThreshold || allowBelowThreshold) &&
            payloads.get(o.id) === orderToCsv(o),
        )
        .map((o) => o.id);
      const snapshots = new Map((current.exportedOrders ?? []).map((order) => [order.id, order]));
      for (const { reviewed, manualEditCount, ...order } of exported) {
        const previous = snapshots.get(order.id);
        if (!previous?.exportedAt || previous.exportedAt <= time)
          snapshots.set(order.id, { ...order, exportedAt: time, lines: order.lines.filter((line) => line.orderQty > 0) });
      }
      return {
        exportedOrderIds: [...new Set([...current.exportedOrderIds, ...ids])],
        exportedOrders: [...snapshots.values()],
      };
    };
    if (commit) await commit(patch);
    else set(patch);
  };

  async function recordDownload(orders: WorkflowOrder[], success: string, allowBelowThreshold = false) {
    const record = { orders, allowBelowThreshold, time: new Date().toISOString() };
    try {
      await markExported(record);
      set({ toast: success });
    } catch {
      setPendingExport(record);
      set({ toast: 'Скачивание запущено. Не удалось записать версию выгрузки.' });
    }
  }

  async function retryExportRecord() {
    if (!pendingExport || busy || saving) return;
    setBusy('Запись отметки…');
    try {
      await markExported(pendingExport);
      setPendingExport(null);
      set({ toast: 'Версия выгрузки сохранена.' });
    } catch {
      set({ toast: 'Версия выгрузки ещё не записана. Повторите попытку.' });
    } finally {
      setBusy('');
    }
  }

  async function zip(mode: ExportMode, inFilter = false) {
    if (pendingExport || busy || saving) return;
    const candidates = mode === 'REVIEWED' ? reviewedExportable : exportable;
    const target = inFilter ? candidates.filter((order) => visibleOrderIds.has(order.id)) : candidates;
    if (target.length === 0) return;
    setExportError('');
    setBusy(`Формирование ${target.length} CSV…`);
    try {
      await downloadReadyOrdersZip(target, verifyExportRevision);
      await recordDownload(target, mode === 'REVIEWED'
        ? `Скачивание ZIP проверенных заказов запущено: ${target.length} CSV.`
        : `Скачивание ZIP запущено: ${target.length} CSV.`);
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
    if (pendingExport || busy || saving) return;
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
      const buffer = await buildSupplierWorkbook(
        supplier,
        supplierOrders,
        mode,
        state.minMax?.skus.map(({ code }) => code),
      );
      await verifyExportRevision();
      save(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        supplierWorkbookFilename(supplier),
      );
      await recordDownload(supplierOrders, `Скачивание Excel для ${supplier} запущено. Заказов: ${supplierOrders.length}.`);
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
        const change = applyOrderQtyChange({
            edits: s.edits,
            reviewedOrderIds: s.reviewedOrderIds,
            exportedOrderIds: s.exportedOrderIds,
            order: current,
            skuCode,
            qty,
        });
        const flags = [
          current.reviewed ? 'проверка снята' : '',
          s.exportedOrderIds.includes(current.id) ? 'состав отличается от выгруженного' : '',
        ].filter(Boolean);
        return flags.length ? { ...change, toast: `${skuCode}: ${flags.join(' · ')}.` } : change;
      };
      if (commit) await commit(patch, checkOrderLines([order.id], skuCode));
      else set(patch);
    } catch (error) {
      if (!(error instanceof WorkspaceConflictError)) {
        console.error('Failed to edit order quantity', error);
        set({ toast: 'Не удалось изменить количество в заказе.' });
      }
      throw error;
    }
  }

  async function setSkuExcluded(
    orderIds: string[],
    skuCode: string,
    excluded: boolean,
  ): Promise<void> {
    const targetIds = new Set(orderIds);
    try {
      const patch = (current: typeof state) => {
        const targets = derive(current).projection.orders.filter(
          (order) =>
            targetIds.has(order.id) &&
            order.lines.some((line) => line.skuCode === skuCode),
        );
        if (
          current.workspaceId !== state.workspaceId ||
          current.snapshotId !== state.snapshotId ||
          targets.length !== targetIds.size
        ) {
          throw new Error('Состав заказов изменился.');
        }
        const patch = applyOrderSkuExclusion({
          edits: current.edits,
          reviewedOrderIds: current.reviewedOrderIds,
          exportedOrderIds: current.exportedOrderIds,
          orders: targets,
          skuCode,
          excluded,
        });
        const changed = targets.filter((order) => Boolean(order.lines.find(({ skuCode: code }) => code === skuCode)?.excluded) !== excluded).length;
        const cleared = current.reviewedOrderIds.length - patch.reviewedOrderIds.length;
        return { ...patch, toast: `${skuCode}: ${excluded ? 'исключён' : 'восстановлен'}. Заказов изменено: ${changed}. Проверок снято: ${cleared}.` };
      };
      setOrderError('');
      if (commit) await commit(patch, checkOrderLines(orderIds, skuCode));
      else set(patch);
      setExclusion(null);
    } catch (error) {
      if (!(error instanceof WorkspaceConflictError))
        console.error('Failed to change order SKU exclusion', error);
      setOrderError(error instanceof WorkspaceConflictError ? error.message
        : excluded ? 'Не удалось исключить позицию. Состав заказов сохранён.'
          : 'Не удалось восстановить позицию. Состав заказов сохранён.');
    }
  }

  async function setAllReviewed(orderIds: string[], reviewed: boolean): Promise<boolean> {
    setOrderError('');
    const patch = (current: typeof state) => {
      if (current.workspaceId !== state.workspaceId || current.snapshotId !== state.snapshotId)
        throw new Error('Рабочий сеанс сменился.');
      const available = new Set(derive(current).projection.orders.map(({ id }) => id));
      if (orderIds.some((id) => !available.has(id))) throw new Error('Состав заказов изменился.');
      const reviewedOrderIds = setOrdersReviewed(current.reviewedOrderIds, orderIds, reviewed);
      const changed = Math.abs(reviewedOrderIds.length - current.reviewedOrderIds.length);
      return {
        reviewedOrderIds,
        toast: reviewed ? `Проверены заказы: ${changed}.` : `Проверок снято: ${changed}.`,
      };
    };
    try {
      if (commit) await commit(patch, checkOrderReview(orderIds, reviewed));
      else set(patch);
      return true;
    } catch (error) {
      setOrderError(error instanceof WorkspaceConflictError ? error.message
        : 'Не удалось сохранить проверку. Предыдущие отметки сохранены.');
      return false;
    }
  }

  const setReviewed = (orderId: string, reviewed: boolean) => setAllReviewed([orderId], reviewed);

  async function exportSingle(
    order: WorkflowOrder,
    allowBelowThreshold: boolean,
  ) {
    if (pendingExport || busy || saving) return;
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
      await recordDownload([order], `Скачивание CSV заказа ${order.branch} → ${order.supplier} запущено.`, allowBelowThreshold);
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
    <main className="compact-workspace orders-page">
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
            disabled={exportable.length === 0 || Boolean(busy || saving || pendingExport)}
            onClick={() => zip('ALL')}
          >
            {busy || `ZIP по всей сети (${exportable.length})`}
          </Button>
          <Button
            className="secondary"
            disabled={
              reviewedExportable.length === 0 || Boolean(busy || saving || pendingExport)
            }
            onClick={() => zip('REVIEWED')}
          >
            ZIP проверенных по сети ({reviewedExportable.length})
          </Button>
          <small className="muted">Сетевые выгрузки включают заказы вне фильтров матрицы.</small>
        </div>
      </header>
      {exportRecovery}
      {orderError && !selected && !selectedSupplier && <Alert tone="danger">{orderError}</Alert>}
      <PurchasingDataAlert issues={derived.projection.dataIssues} />
      {derived.projection.unassigned.length > 0 && (
        <Button className="secondary" onClick={() => set((current) => ({
          page: 'suppliers',
          uiPreferences: { ...current.uiPreferences, 'suppliers:productFilters': {
            query: '', primary: 'without-primary', supplier: '', role: 'any', hasDemand: true,
          } },
        }))}>Открыть товары без основного поставщика</Button>
      )}
      {exportError && <Alert tone="danger">{exportError}</Alert>}

      <div className="order-filter-grid">
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
          <label className="checkbox-control">
            <input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
            К проверке
          </label>
          {reviewOnly && <Button className="secondary" disabled={!visibleReviewIds.length || saving}
            onClick={() => void setAllReviewed(visibleReviewIds, true)}>
            Отметить по фильтру ({visibleReviewIds.length})
          </Button>}
          {affected.length > 0 && <Button className="secondary" onClick={() => setAffected([])}>
            Изменившиеся заказы ({affected.length}) · снять фильтр
          </Button>}
          {(supplierQuery || reviewOnly || affected.length > 0) && <Button className="secondary"
            disabled={Boolean(busy || saving || pendingExport) || !exportable.some(({ id }) => visibleOrderIds.has(id))}
            onClick={() => void zip('ALL', true)}>ZIP по фильтру</Button>}
          <span>
            В матрице: <strong>{visibleOrders.length}</strong> заказов
          </span>
          {supplierQuery && (
            <button className="link" onClick={() => setSupplierQuery('')}>
              Сбросить поиск
            </button>
          )}
        </section>
      </div>

      <div className="metrics compact-metrics">
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
                const fileAmount = summarizeOrders(supplierReviewedExportable).amount;
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
                            Boolean(busy || saving || pendingExport)
                          }
                          onClick={() => excel(supplier, 'ALL')}
                        >
                          Excel все
                        </Button>
                        <Button
                          className="secondary"
                          disabled={
                            supplierReviewedExportable.length === 0 ||
                            Boolean(busy || saving || pendingExport)
                          }
                          onClick={() => excel(supplier, 'REVIEWED')}
                        >
                          Проверенные {supplierReviewedExportable.length}/
                          {supplierExportable.length}
                        </Button>
                        {supplierReviewedExportable.length > 0 && fileAmount !== null && (
                          <small className={state.settings.thresholdMode === 'SUPPLIER_TOTAL' && fileAmount < state.settings.minimumOrderAmount ? 'warning-text' : 'muted'}>
                            Excel проверенных: {money(fileAmount)}
                            {state.settings.minimumOrderAmount > 0 && state.settings.thresholdMode === 'SUPPLIER_TOTAL'
                              ? ` · минимум поставщика ${money(state.settings.minimumOrderAmount)}` : ''}
                          </small>
                        )}
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
          {hiddenBelowThreshold > 0 && <> <Button className="secondary" onClick={() => setShowBelowThreshold(true)}>
            Показать заказы ниже порога ({hiddenBelowThreshold})
          </Button></>}
        </EmptyState>
      )}

      {selected && (
        <OrderDrawer
          order={selected}
          dataIssues={derived.projection.dataIssues}
          exported={exportedIds.has(selected.id)}
          exportError={exportError || orderError}
          exportRecovery={exportRecovery}
          lastExport={savedExports.get(selected.id)}
          threshold={thresholdAmount == null ? undefined : {
            scope: state.settings.thresholdMode === 'SUPPLIER_TOTAL' ? 'По поставщику в целом' : 'По заказу подразделения',
            limit: state.settings.minimumOrderAmount,
            amount: thresholdAmount,
          }}
          reviewQueue={reviewOnly}
          exportDisabled={Boolean(pendingExport)}
          saving={Boolean(busy || saving)}
          renderMovement={renderOrderMovement}
          onClose={() => setSelectedId(null)}
          onEdit={(skuCode, _branch, qty) => editOrder(selected, skuCode, qty)}
          onSetExcluded={(skuCode, excluded) =>
            setSkuExcluded([selected.id], skuCode, excluded)
          }
          onReviewedChange={(reviewed) => setReviewed(selected.id, reviewed)}
          onReviewAndNext={nextReviewId ? async () => {
            if (await setReviewed(selected.id, true)) setSelectedId(nextReviewId);
          } : undefined}
          onReconcile={
            onReconcile && (savedExports.has(selected.id) || canReconcileOrder(selected, exportedIds.has(selected.id)))
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
          feedback={orderError}
          dataIssues={derived.projection.dataIssues}
          saving={Boolean(busy || saving)}
          renderMovement={renderOrderMovement}
          orders={selectedSupplierOrders}
          compareSku={derived.compareSku}
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
          onSetExcluded={(orderIds, skuCode, excluded) => {
            if (orderIds.length > 1) {
              setOrderError('');
              setExclusion({ orderIds, skuCode, excluded });
            } else void setSkuExcluded(orderIds, skuCode, excluded);
          }}
          onSetReviewed={setReviewed}
          onSetAllReviewed={setAllReviewed}
          onReconcile={
            onReconcile && eligibleSupplierOrderIds.length
              ? () => onReconcile(eligibleSupplierOrderIds)
              : undefined
          }
        />
      )}
      {exclusion && (
        <Dialog title={exclusion.excluded ? `Исключить ${exclusion.skuCode} из заказов?` : `Восстановить ${exclusion.skuCode} в заказах?`}
          onClose={() => { if (!saving) setExclusion(null); }}
          actions={<>
            <Button className="secondary" disabled={saving} onClick={() => setExclusion(null)}>Отмена</Button>
            <Button disabled={saving} onClick={() => void setSkuExcluded(exclusion.orderIds, exclusion.skuCode, exclusion.excluded)}>
              {exclusion.excluded ? 'Исключить' : 'Восстановить'}
            </Button>
          </>}>
          <p>Заказов в операции: {exclusionTargets.length}. Проверок к снятию: {exclusionChecks}.</p>
          <p>Подразделения: {exclusionTargets.map(({ branch }) => branch).join(', ')}.</p>
          {exclusion.excluded && !exclusionRemovedAmounts.includes(null) &&
            <p>Сумма исключаемых позиций: {money(moneySum(exclusionRemovedAmounts as number[]))}.</p>}
          {orderError && <Alert tone="danger">{orderError}</Alert>}
        </Dialog>
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
