import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, useModalLayer } from '../../components/Dialog';
import type { OrderLine } from '../../domain/types';
import type { WorkflowOrder } from '../../app/selectors';
import { QuantityInput } from '../../components/QuantityInput';
import { Alert, Button } from '../../components/ui';
import { fmtQty, money, priceSourceLabel } from '../demand/DemandPage';

export function OrderDrawer({
  order,
  onClose,
  onEdit,
  onReviewedChange,
  onExport,
  renderMovement,
  saving = false,
}: {
  order: WorkflowOrder;
  saving?: boolean | undefined;
  renderMovement?: ((line: OrderLine) => ReactNode) | undefined;
  onClose: () => void;
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
              {fmtQty(order.totalQty)} ед. ·{' '}
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

        <div className="table-wrap drawer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Артикул</th>
                <th>Наименование</th>
                <th className="num">Остаток по отчёту</th>
                <th className="num">MIN</th>
                <th className="num">MAX</th>
                <th className="num">Расчёт до MAX</th>
                <th>К заказу</th>
                <th className="num">Цена</th>
                <th>Источник цены</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.skuCode}>
                  <td>
                    <strong>{line.skuCode}</strong>
                  </td>
                  <td>{line.article ?? '—'}</td>
                  <td>{line.name}</td>
                  <td className="num">{fmtQty(line.stock)}</td>
                  <td className="num">{line.min ?? '—'}</td>
                  <td className="num">{line.max ?? '—'}</td>
                  <td className="num">
                    {fmtQty(line.calculatedQty)}
                    {renderMovement?.(line)}
                  </td>
                  <td>
                    <QuantityInput
                      className={
                        line.orderQty !== line.calculatedQty ? 'manual-qty' : ''
                      }
                      aria-label={`Количество ${line.skuCode}`}
                      value={line.orderQty}
                      onCommit={(qty) => onEdit(line.skuCode, line.branch, qty)}
                    />
                    {line.warnings.map((warning) => (
                      <small className="warning-text" key={warning}>
                        {warning}
                      </small>
                    ))}
                  </td>
                  <td className="num">
                    {line.unitPrice == null
                      ? 'Нет цены'
                      : money(line.unitPrice)}
                  </td>
                  <td>{priceSourceLabel(line.priceSource)}</td>
                  <td className="num">
                    {line.amount == null ? '—' : money(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="drawer-actions">
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
