import type { Order } from '../../domain/types';
import { Alert, Button, Input } from '../../components/ui';
import { fmtQty, money, priceSourceLabel } from '../demand/DemandPage';

export function OrderDrawer({
  order,
  onClose,
  onEdit,
  onExport,
}: {
  order: Order;
  onClose: () => void;
  onEdit: (skuCode: string, branch: string, qty: number) => void;
  onExport: (allowBelowThreshold: boolean) => void;
}) {
  const canNormalExport = order.status === 'READY' || order.status === 'EXPORTED';
  const canOverrideThreshold =
    order.status === 'BLOCKED' &&
    order.blockers.length === 1 &&
    order.blockers[0] === 'Ниже минимальной суммы';

  return (
    <div className="drawer-back" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="drawer" aria-label="Состав заказа">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Состав заказа</p>
            <h2>{order.supplier} → {order.branch}</h2>
            <p>{order.lines.filter((line) => line.orderQty > 0).length} SKU · {fmtQty(order.totalQty)} ед. · {order.totalAmount == null ? 'Сумма неизвестна' : money(order.totalAmount)}</p>
          </div>
          <button className="close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        {order.blockers.length > 0 && (
          <Alert tone={canOverrideThreshold ? 'warning' : 'danger'}>
            <strong>{canOverrideThreshold ? 'Заказ ниже минимального порога.' : 'Заказ заблокирован.'}</strong>{' '}
            {order.blockers.join('. ')}
          </Alert>
        )}

        <div className="table-wrap drawer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Код</th>
                <th>Товар</th>
                <th className="num">Остаток</th>
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
                  <td>{line.article ?? '—'}</td>
                  <td><strong>{line.skuCode}</strong></td>
                  <td>{line.name}</td>
                  <td className="num">{fmtQty(line.stock)}</td>
                  <td className="num">{line.min ?? '—'}</td>
                  <td className="num">{line.max ?? '—'}</td>
                  <td className="num">{fmtQty(line.calculatedQty)}</td>
                  <td>
                    <Input
                      aria-label={`Количество ${line.skuCode}`}
                      type="number"
                      min="0"
                      step="any"
                      value={line.orderQty}
                      onChange={(event) => {
                        const qty = Number(event.target.value);
                        if (Number.isFinite(qty) && qty >= 0) onEdit(line.skuCode, line.branch, qty);
                      }}
                    />
                    {line.warnings.map((warning) => <small className="warning-text" key={warning}>{warning}</small>)}
                  </td>
                  <td className="num">{line.unitPrice == null ? 'Нет цены' : money(line.unitPrice)}</td>
                  <td>{priceSourceLabel(line.priceSource)}</td>
                  <td className="num">{line.amount == null ? '—' : money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="drawer-actions">
          {canOverrideThreshold && (
            <Button
              className="secondary danger-action"
              onClick={() => {
                if (window.confirm('Заказ ниже установленной минимальной суммы. Выгрузить его несмотря на порог?')) onExport(true);
              }}
            >
              Выгрузить несмотря на порог
            </Button>
          )}
          <Button disabled={!canNormalExport} onClick={() => onExport(false)}>
            {order.status === 'EXPORTED' ? 'Скачать CSV ещё раз' : 'Скачать CSV заказа'}
          </Button>
        </div>
      </aside>
    </div>
  );
}
