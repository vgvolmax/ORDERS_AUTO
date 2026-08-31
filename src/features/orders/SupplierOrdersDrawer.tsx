import { useMemo } from 'react';
import type { WorkflowOrder } from '../../app/selectors';
import { Button, Input } from '../../components/ui';
import type { OrderLine } from '../../domain/types';
import { fmtQty, money } from '../demand/DemandPage';

interface MatrixCell {
  order: WorkflowOrder;
  line: OrderLine;
}

interface MatrixRow {
  skuCode: string;
  article: string | null;
  name: string;
  unitPrice: number | null;
  cells: Map<string, MatrixCell>;
  totalQty: number;
  totalAmount: number | null;
}

export function SupplierOrdersDrawer({
  supplier,
  orders,
  branchOrder,
  onClose,
  onEdit,
  onSetReviewed,
  onSetAllReviewed,
}: {
  supplier: string;
  orders: WorkflowOrder[];
  branchOrder: string[];
  onClose: () => void;
  onEdit: (order: WorkflowOrder, skuCode: string, qty: number) => void;
  onSetReviewed: (orderId: string, reviewed: boolean) => void;
  onSetAllReviewed: (orderIds: string[], reviewed: boolean) => void;
}) {
  const model = useMemo(
    () => buildMatrixModel(orders, branchOrder),
    [orders, branchOrder],
  );
  const reviewedCount = orders.filter((order) => order.reviewed).length;
  const supplierTotal = completeOrderTotal(orders);

  return (
    <div className="drawer-back" role="presentation">
      <section
        className="drawer supplier-orders-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Все заказы ${supplier}`}
      >
        <div className="drawer-head supplier-matrix-head">
          <div>
            <p className="eyebrow">Все заказы поставщика</p>
            <h2>{supplier}</h2>
            <div className="supplier-matrix-summary">
              <strong>
                {supplierTotal == null ? 'Сумма неизвестна' : money(supplierTotal)}
              </strong>
              <span>{orders.length} подразделений</span>
              <span>{model.rows.length} SKU</span>
              <span>
                ✓ {reviewedCount} из {orders.length} проверено
              </span>
            </div>
          </div>
          <button className="close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="supplier-review-actions">
          <Button
            className="secondary"
            onClick={() =>
              onSetAllReviewed(
                orders.map((order) => order.id),
                true,
              )
            }
          >
            Отметить все проверенными
          </Button>
          <Button
            className="secondary"
            onClick={() =>
              onSetAllReviewed(
                orders.map((order) => order.id),
                false,
              )
            }
          >
            Снять проверку со всех
          </Button>
        </div>

        <div className="table-wrap supplier-matrix-wrap">
          <table className="supplier-order-matrix">
            <thead>
              <tr>
                <th className="sticky-id sticky-code">Код</th>
                <th className="sticky-id sticky-article">Артикул</th>
                <th className="sticky-id sticky-name">Номенклатура</th>
                <th className="num">Цена</th>
                {model.branches.map((branch) => {
                  const order = model.orderByBranch.get(branch)!;
                  return (
                    <th key={branch} className="supplier-branch-column">
                      <div className="supplier-branch-head">
                        <strong>{branch}</strong>
                        <span>
                          {order.totalAmount == null
                            ? 'Сумма неизвестна'
                            : money(order.totalAmount)}
                        </span>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Проверен ${branch}`}
                            checked={order.reviewed}
                            onChange={(event) =>
                              onSetReviewed(order.id, event.target.checked)
                            }
                          />
                          <span>{order.reviewed ? '✓ Проверен' : 'Не проверен'}</span>
                        </label>
                        {order.manualEditCount > 0 && (
                          <small className="manual-indicator">
                            ✋ {order.manualEditCount}
                          </small>
                        )}
                        {hasHardBlocker(order) && (
                          <small className="danger-text">Есть блокирующая ошибка</small>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th className="num total-column">Всего, шт.</th>
                <th className="num total-column">Всего, ₽</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.skuCode}>
                  <td className="sticky-id sticky-code">
                    <strong>{row.skuCode}</strong>
                  </td>
                  <td className="sticky-id sticky-article">
                    {row.article ?? '—'}
                  </td>
                  <td className="sticky-id sticky-name">{row.name}</td>
                  <td className="num">
                    {row.unitPrice == null ? '—' : money(row.unitPrice)}
                  </td>
                  {model.branches.map((branch) => {
                    const cell = row.cells.get(branch);
                    return (
                      <td key={branch} className="num matrix-qty-cell">
                        {cell ? (
                          <Input
                            className={
                              cell.line.orderQty !== cell.line.calculatedQty
                                ? 'matrix-qty-input manual'
                                : 'matrix-qty-input'
                            }
                            aria-label={`Количество ${row.skuCode} ${branch}`}
                            type="number"
                            min="0"
                            step="any"
                            value={cell.line.orderQty}
                            onChange={(event) => {
                              if (event.target.value === '') {
                                return;
                              }
                              const qty = Number(event.target.value);
                              if (Number.isFinite(qty) && qty >= 0) {
                                onEdit(cell.order, row.skuCode, qty);
                              }
                            }}
                          />
                        ) : (
                          <span className="matrix-empty">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num total-column">
                    <strong>{fmtQty(row.totalQty)}</strong>
                  </td>
                  <td className="num total-column">
                    <strong>
                      {row.totalAmount == null
                        ? '—'
                        : money(row.totalAmount)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function buildMatrixModel(
  orders: WorkflowOrder[],
  branchOrder: string[],
): {
  branches: string[];
  orderByBranch: Map<string, WorkflowOrder>;
  rows: MatrixRow[];
} {
  const orderByBranch = new Map(orders.map((order) => [order.branch, order]));
  const rank = new Map(branchOrder.map((branch, index) => [branch, index]));
  const branches = [...orderByBranch.keys()].sort(
    (left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right, 'ru'),
  );

  const rowsBySku = new Map<
    string,
    Omit<MatrixRow, 'totalQty' | 'totalAmount'>
  >();

  for (const order of orders) {
    for (const line of order.lines) {
      const row = rowsBySku.get(line.skuCode) ?? {
        skuCode: line.skuCode,
        article: line.article,
        name: line.name,
        unitPrice: line.unitPrice,
        cells: new Map<string, MatrixCell>(),
      };
      row.cells.set(order.branch, { order, line });
      rowsBySku.set(line.skuCode, row);
    }
  }

  const rows = [...rowsBySku.values()]
    .map((row): MatrixRow => {
      const cells = [...row.cells.values()];
      const positiveCells = cells.filter((cell) => cell.line.orderQty > 0);
      const hasMissingAmount = positiveCells.some(
        (cell) => cell.line.amount == null,
      );
      return {
        ...row,
        totalQty: cells.reduce((sum, cell) => sum + cell.line.orderQty, 0),
        totalAmount: hasMissingAmount
          ? null
          : positiveCells.reduce(
              (sum, cell) => sum + (cell.line.amount ?? 0),
              0,
            ),
      };
    })
    .sort(
      (left, right) =>
        left.skuCode.localeCompare(right.skuCode, 'ru', { numeric: true }) ||
        left.name.localeCompare(right.name, 'ru'),
    );

  return { branches, orderByBranch, rows };
}

function completeOrderTotal(orders: WorkflowOrder[]): number | null {
  if (orders.some((order) => order.totalAmount == null)) {
    return null;
  }
  return orders.reduce((sum, order) => sum + (order.totalAmount ?? 0), 0);
}

function hasHardBlocker(order: WorkflowOrder): boolean {
  return order.blockers.some(
    (blocker) => blocker !== 'Ниже минимальной суммы',
  );
}
