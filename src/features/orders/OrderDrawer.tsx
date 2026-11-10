import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, useModalLayer } from '../../components/Dialog';
import type { OrderLine } from '../../domain/types';
import type { WorkflowOrder } from '../../app/selectors';
import { QuantityInput } from '../../components/QuantityInput';
import { Alert, Button } from '../../components/ui';
import { QuantitySummary } from '../../components/QuantitySummary';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import { fmtQty, money, priceSourceLabel } from '../demand/DemandPage';

const orderLineKey = (line: OrderLine) => line.skuCode;

export function OrderDrawer({
  order,
  exported,
  onClose,
  onEdit,
  onReviewedChange,
  onExport,
  renderMovement,
  onReconcile,
  saving = false,
  exportError = '',
}: {
  order: WorkflowOrder;
  exported: boolean;
  saving?: boolean | undefined;
  exportError?: string;
  renderMovement?: ((line: OrderLine) => ReactNode) | undefined;
  onClose: () => void;
  onReconcile?: (() => void) | undefined;
  onEdit: (
    skuCode: string,
    branch: string,
    qty: number,
  ) => void | Promise<void>;
  onReviewedChange: (reviewed: boolean) => void;
  onExport: (allowBelowThreshold: boolean) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useModalLayer(ref, onClose);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const canNormalExport =
    order.status === 'READY' || order.status === 'EXPORTED';
  const canOverrideThreshold =
    order.status === 'BLOCKED' &&
    order.blockers.length === 1 &&
    order.blockers[0] === 'Ниже минимальной суммы';
  const hardBlocked = order.blockers.some(
    (blocker) => blocker !== 'Ниже минимальной суммы',
  );

  const columns: VirtualColumn<OrderLine>[] = [
    { key: 'sku', header: 'Код', width: '100px', render: (line) => <strong>{line.skuCode}</strong> },
    { key: 'article', header: 'Артикул', width: '110px', render: (line) => line.article ?? '—' },
    { key: 'name', header: 'Наименование', width: 'minmax(170px, 1fr)', render: (line) => line.name },
    {
      key: 'stock', header: 'Остаток по отчёту', width: '100px', className: 'num',
      render: (line) => fmtQty(line.stock),
    },
    { key: 'min', header: 'MIN', width: '55px', className: 'num', render: (line) => line.min ?? '—' },
    { key: 'max', header: 'MAX', width: '55px', className: 'num', render: (line) => line.max ?? '—' },
    {
      key: 'calculated', header: 'Расчёт до MAX', width: '108px', className: 'num',
      render: (line) => <>{fmtQty(line.calculatedQty)}{renderMovement?.(line)}</>,
    },
    {
      key: 'quantity', header: 'К заказу', width: '115px',
      render: (line) => (
        <>
          <QuantityInput
            className={line.orderQty !== line.calculatedQty ? 'manual-qty' : ''}
            aria-label={`Количество ${line.skuCode}`}
            value={line.orderQty}
            onCommit={(qty) => onEdit(line.skuCode, line.branch, qty)}
          />
          {line.warnings.map((warning) => (
            <small className="warning-text" key={warning}>{warning}</small>
          ))}
        </>
      ),
    },
    {
      key: 'price', header: 'Цена', width: '95px', className: 'num',
      render: (line) => line.unitPrice == null ? 'Нет цены' : money(line.unitPrice),
    },
    {
      key: 'price-source', header: 'Источник цены', width: '108px',
      render: (line) => priceSourceLabel(line.priceSource),
    },
    {
      key: 'amount', header: 'Сумма', width: '115px', className: 'num',
      render: (line) => line.amount == null ? '—' : money(line.amount),
    },
  ];

  return createPortal(
    <div
      className="drawer-back"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        ref={ref}
        tabIndex={-1}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Состав заказа"
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Состав заказа</p>
            <h2>
              {order.supplier} → {order.branch}
            </h2>
            <p>
              {order.lines.filter((line) => line.orderQty > 0).length} SKU ·{' '}
              <QuantitySummary
                rows={order.lines.map((line) => ({
                  skuCode: line.skuCode,
                  qty: line.orderQty,
                  unit: line.unit,
                }))}
              />{' '}
              ·{' '}
              {order.totalAmount == null
                ? 'Сумма неизвестна'
                : money(order.totalAmount)}
            </p>
            <div className="order-review-strip">
              <label
                className={`review-toggle ${
                  order.reviewed ? 'is-reviewed' : ''
                } ${hardBlocked ? 'has-blocker' : ''}`}
              >
                <input
                  type="checkbox"
                  aria-label="Заказ проверен"
                  checked={order.reviewed}
                  disabled={saving}
                  onChange={(event) => onReviewedChange(event.target.checked)}
                />
                <span>
                  {order.reviewed ? '✓ Заказ проверен' : 'Заказ не проверен'}
                </span>
              </label>
              {exported && <span className="badge OK">Выгружен</span>}
              {order.manualEditCount > 0 && (
                <span className="manual-indicator">
                  ✋ {order.manualEditCount} изменено
                </span>
              )}
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        {order.blockers.length > 0 && (
          <Alert tone={canOverrideThreshold ? 'warning' : 'danger'}>
            <strong>
              {canOverrideThreshold
                ? 'Заказ ниже минимального порога.'
                : 'Заказ заблокирован.'}
            </strong>{' '}
            {order.blockers.join('. ')}
          </Alert>
        )}
        {exportError && <Alert tone="danger">{exportError}</Alert>}

        <VirtualTable
          rows={order.lines}
          columns={columns}
          getRowKey={orderLineKey}
          maxHeight="calc(100vh - 260px)"
          estimateRowHeight={52}
        />

        <div className="drawer-actions">
          {onReconcile && (
            <Button className="secondary" disabled={saving} onClick={onReconcile}>
              Сверить счёт
            </Button>
          )}
          {canOverrideThreshold && (
            <Button
              className="secondary danger-action"
              disabled={saving}
              onClick={() => setOverrideOpen(true)}
            >
              Выгрузить несмотря на порог
            </Button>
          )}
          <Button
            disabled={!canNormalExport || saving}
            onClick={() => onExport(false)}
          >
            {order.status === 'EXPORTED'
              ? 'Скачать CSV ещё раз'
              : 'Скачать CSV заказа'}
          </Button>
        </div>
      </aside>
      {overrideOpen && (
        <Dialog
          title="Выгрузить заказ ниже порога?"
          onClose={() => setOverrideOpen(false)}
          actions={
            <>
              <Button
                className="secondary"
                onClick={() => setOverrideOpen(false)}
              >
                Отмена
              </Button>
              <Button
                onClick={() => {
                  setOverrideOpen(false);
                  onExport(true);
                }}
              >
                Выгрузить несмотря на порог
              </Button>
            </>
          }
        >
          <p>
            Заказ ниже установленной минимальной суммы. Он будет выгружен с
            текущими количествами.
          </p>
        </Dialog>
      )}
    </div>,
    document.body,
  );
}
