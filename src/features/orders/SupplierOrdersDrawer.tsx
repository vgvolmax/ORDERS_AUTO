import { useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { WorkflowOrder } from '../../app/selectors';
import { Button, Input } from '../../components/ui';
import type { OrderLine } from '../../domain/types';
import { fmtQty, money } from '../demand/DemandPage';

const COLUMN_WIDTHS_STORAGE_KEY = 'orders-auto:supplier-matrix-column-widths:v1';
const RESIZE_KEYBOARD_STEP = 12;

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

interface MatrixModel {
  branches: string[];
  orderByBranch: Map<string, WorkflowOrder>;
  rows: MatrixRow[];
}

interface ResizeSession {
  key: string;
  pointerId: number;
  startX: number;
  startWidth: number;
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
  const defaultWidths = useMemo(() => buildDefaultColumnWidths(model), [model]);
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>(
    readStoredColumnWidths,
  );
  const resizeSession = useRef<ResizeSession | null>(null);

  const reviewedCount = orders.filter(
    (order) => order.reviewed && !hasHardBlocker(order),
  ).length;
  const supplierTotal = completeOrderTotal(orders);

  const widthFor = (key: string) =>
    clampColumnWidth(
      key,
      widthOverrides[key] ?? defaultWidths[key] ?? fallbackColumnWidth(key),
    );

  const setColumnWidth = (key: string, value: number) => {
    const nextWidth = clampColumnWidth(key, value);
    setWidthOverrides((current) => {
      const next = { ...current, [key]: nextWidth };
      persistColumnWidths(next);
      return next;
    });
  };

  const resetColumnWidth = (key: string) => {
    setWidthOverrides((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      persistColumnWidths(next);
      return next;
    });
  };

  const resetAllColumnWidths = () => {
    setWidthOverrides({});
    persistColumnWidths({});
  };

  const startResize = (
    key: string,
    width: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeSession.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
  };

  const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    setColumnWidth(
      session.key,
      session.startWidth + event.clientX - session.startX,
    );
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    resizeSession.current = null;
  };

  const resizeFromKeyboard = (
    key: string,
    currentWidth: number,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    setColumnWidth(
      key,
      currentWidth +
        (event.key === 'ArrowRight'
          ? RESIZE_KEYBOARD_STEP
          : -RESIZE_KEYBOARD_STEP),
    );
  };

  const resizer = (key: string, label: string, width: number) => (
    <button
      type="button"
      className="column-resizer"
      aria-label={`Изменить ширину столбца ${label}`}
      title="Потяните для изменения ширины. Двойной клик — сбросить."
      onPointerDown={(event) => startResize(key, width, event)}
      onPointerMove={moveResize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onDoubleClick={() => resetColumnWidth(key)}
      onKeyDown={(event) => resizeFromKeyboard(key, width, event)}
    />
  );

  const codeWidth = widthFor('code');
  const articleWidth = widthFor('article');
  const nameWidth = widthFor('name');
  const priceWidth = widthFor('price');
  const totalQtyWidth = widthFor('totalQty');
  const totalAmountWidth = widthFor('totalAmount');
  const articleLeft = codeWidth;
  const nameLeft = codeWidth + articleWidth;

  const sizedStyle = (width: number, extra?: CSSProperties): CSSProperties => ({
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
    ...extra,
  });

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
                {reviewedCount === orders.length
                  ? `✓ Все ${orders.length} заказов проверены`
                  : `✓ ${reviewedCount} из ${orders.length} проверено`}
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
          <Button className="secondary" onClick={resetAllColumnWidths}>
            Сбросить ширину столбцов
          </Button>
        </div>

        <div className="table-wrap supplier-matrix-wrap">
          <table className="supplier-order-matrix">
            <colgroup>
              <col style={{ width: `${codeWidth}px` }} />
              <col style={{ width: `${articleWidth}px` }} />
              <col style={{ width: `${nameWidth}px` }} />
              <col style={{ width: `${priceWidth}px` }} />
              {model.branches.map((branch) => (
                <col
                  key={branch}
                  style={{ width: `${widthFor(branchColumnKey(branch))}px` }}
                />
              ))}
              <col style={{ width: `${totalQtyWidth}px` }} />
              <col style={{ width: `${totalAmountWidth}px` }} />
            </colgroup>
            <thead>
              <tr>
                <th
                  className="sticky-id sticky-code resizable-column"
                  style={sizedStyle(codeWidth, { left: 0 })}
                >
                  Код
                  {resizer('code', 'Код', codeWidth)}
                </th>
                <th
                  className="sticky-id sticky-article resizable-column"
                  style={sizedStyle(articleWidth, { left: articleLeft })}
                >
                  Артикул
                  {resizer('article', 'Артикул', articleWidth)}
                </th>
                <th
                  className="sticky-id sticky-name resizable-column"
                  style={sizedStyle(nameWidth, { left: nameLeft })}
                >
                  Номенклатура
                  {resizer('name', 'Номенклатура', nameWidth)}
                </th>
                <th
                  className="num resizable-column"
                  style={sizedStyle(priceWidth)}
                >
                  Цена
                  {resizer('price', 'Цена', priceWidth)}
                </th>
                {model.branches.map((branch) => {
                  const order = model.orderByBranch.get(branch)!;
                  const blocker = hasHardBlocker(order);
                  const branchKey = branchColumnKey(branch);
                  const branchWidth = widthFor(branchKey);
                  return (
                    <th
                      key={branch}
                      className={`supplier-branch-column resizable-column ${order.reviewed && !blocker ? 'is-reviewed' : ''} ${blocker ? 'has-blocker' : ''}`}
                      style={sizedStyle(branchWidth)}
                    >
                      <div className="supplier-branch-head">
                        <strong className="supplier-branch-name" title={branch}>
                          {branch}
                        </strong>
                        <span className="supplier-branch-total">
                          {order.totalAmount == null
                            ? 'Сумма неизвестна'
                            : money(order.totalAmount)}
                        </span>
                        <div className="supplier-branch-meta">
                          <label className="supplier-branch-review">
                            <input
                              type="checkbox"
                              aria-label={`Проверен ${branch}`}
                              checked={order.reviewed}
                              onChange={(event) =>
                                onSetReviewed(order.id, event.target.checked)
                              }
                            />
                            <span>{order.reviewed ? 'Проверен' : 'Не проверен'}</span>
                          </label>
                          {order.manualEditCount > 0 && (
                            <small
                              className="manual-indicator"
                              title="Есть ручные изменения количества"
                            >
                              ✋ {order.manualEditCount}
                            </small>
                          )}
                        </div>
                        {blocker && (
                          <small className="danger-text supplier-branch-blocker">
                            Есть блокирующая ошибка
                          </small>
                        )}
                      </div>
                      {resizer(branchKey, branch, branchWidth)}
                    </th>
                  );
                })}
                <th
                  className="num total-column sticky-total sticky-total-qty resizable-column"
                  style={sizedStyle(totalQtyWidth, { right: totalAmountWidth })}
                >
                  Всего, шт.
                  {resizer('totalQty', 'Всего, шт.', totalQtyWidth)}
                </th>
                <th
                  className="num total-column sticky-total sticky-total-amount resizable-column"
                  style={sizedStyle(totalAmountWidth, { right: 0 })}
                >
                  Всего, ₽
                  {resizer('totalAmount', 'Всего, ₽', totalAmountWidth)}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.skuCode}>
                  <td
                    className="sticky-id sticky-code"
                    style={sizedStyle(codeWidth, { left: 0 })}
                  >
                    <strong>{row.skuCode}</strong>
                  </td>
                  <td
                    className="sticky-id sticky-article"
                    style={sizedStyle(articleWidth, { left: articleLeft })}
                  >
                    {row.article ?? '—'}
                  </td>
                  <td
                    className="sticky-id sticky-name"
                    style={sizedStyle(nameWidth, { left: nameLeft })}
                  >
                    <span className="supplier-name-cell" title={row.name}>
                      {row.name}
                    </span>
                  </td>
                  <td className="num" style={sizedStyle(priceWidth)}>
                    {row.unitPrice == null ? '—' : money(row.unitPrice)}
                  </td>
                  {model.branches.map((branch) => {
                    const cell = row.cells.get(branch);
                    const branchWidth = widthFor(branchColumnKey(branch));
                    return (
                      <td
                        key={branch}
                        className="num matrix-qty-cell"
                        style={sizedStyle(branchWidth)}
                      >
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
                  <td
                    className="num total-column sticky-total sticky-total-qty"
                    style={sizedStyle(totalQtyWidth, { right: totalAmountWidth })}
                  >
                    <strong>{fmtQty(row.totalQty)}</strong>
                  </td>
                  <td
                    className="num total-column sticky-total sticky-total-amount"
                    style={sizedStyle(totalAmountWidth, { right: 0 })}
                  >
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
): MatrixModel {
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

function buildDefaultColumnWidths(model: MatrixModel): Record<string, number> {
  const maxNameLength = Math.max(
    'Номенклатура'.length,
    ...model.rows.map((row) => row.name.length),
  );

  const widths: Record<string, number> = {
    code: estimateSingleLineWidth(
      ['Код', ...model.rows.map((row) => row.skuCode)],
      64,
      100,
    ),
    article: estimateSingleLineWidth(
      ['Артикул', ...model.rows.map((row) => row.article ?? '—')],
      82,
      130,
    ),
    name: clamp(210 + Math.min(maxNameLength, 80) * 1.35, 240, 320),
    price: estimateSingleLineWidth(
      [
        'Цена',
        ...model.rows.map((row) =>
          row.unitPrice == null ? '—' : money(row.unitPrice),
        ),
      ],
      88,
      112,
    ),
    totalQty: 100,
    totalAmount: 116,
  };

  for (const branch of model.branches) {
    widths[branchColumnKey(branch)] = estimateSingleLineWidth(
      [branch, 'Не проверен'],
      128,
      170,
      30,
    );
  }

  return widths;
}

function estimateSingleLineWidth(
  values: string[],
  min: number,
  max: number,
  padding = 26,
): number {
  const longest = values.reduce(
    (length, value) => Math.max(length, value.length),
    0,
  );
  return Math.round(clamp(padding + longest * 7.2, min, max));
}

function branchColumnKey(branch: string): string {
  return `branch:${branch}`;
}

function fallbackColumnWidth(key: string): number {
  if (key.startsWith('branch:')) {
    return 140;
  }
  return 120;
}

function columnBounds(key: string): { min: number; max: number } {
  if (key === 'code') return { min: 56, max: 180 };
  if (key === 'article') return { min: 72, max: 280 };
  if (key === 'name') return { min: 180, max: 600 };
  if (key === 'price') return { min: 78, max: 180 };
  if (key === 'totalQty') return { min: 84, max: 180 };
  if (key === 'totalAmount') return { min: 96, max: 220 };
  return { min: 108, max: 260 };
}

function clampColumnWidth(key: string, value: number): number {
  const bounds = columnBounds(key);
  return Math.round(clamp(value, bounds.min, bounds.max));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredColumnWidths(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === 'number' && Number.isFinite(value)
          ? [[key, clampColumnWidth(key, value)]]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

function persistColumnWidths(widths: Record<string, number>): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (Object.keys(widths).length === 0) {
      window.localStorage.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // UI preferences are optional; storage failures must not block ordering work.
  }
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
