import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, useModalLayer } from '../../components/Dialog';
import { QuantityInput } from '../../components/QuantityInput';
import { VirtualTable } from '../../components/VirtualTable';
import { Alert, Button, SearchInput } from '../../components/ui';
import type { DonorPlanCommand } from '../../app/rebalanceActions';
import type { DonorAllocationRow } from '../../domain/rebalancing/allocationPlan';
import type { DonorSplitMode } from '../../domain/rebalancing/types';
import { fmtQty } from '../demand/DemandPage';
import { useTransferPageSize } from './useTransferPageSize';

export function DonorAllocationDrawer({
  name,
  fromBranchId,
  rows,
  mode,
  onEdit,
  onClose,
  onResults,
  stale,
  saving,
  error,
}: {
  name: string;
  fromBranchId: string;
  rows: DonorAllocationRow[];
  mode: DonorSplitMode;
  onEdit: (command: DonorPlanCommand) => Promise<void>;
  onClose: () => void;
  onResults: () => void;
  stale: boolean;
  saving: boolean;
  error: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useModalLayer(ref, onClose);
  const { frameRef, pageSize } = useTransferPageSize();
  const [query, setQuery] = useState(''),
    [onlyShortage, setOnlyShortage] = useState(false);
  const [page, setPage] = useState(0),
    [recipientPage, setRecipientPage] = useState(0),
    [columnCount, setColumnCount] = useState(2);
  const [product, setProduct] = useState<DonorAllocationRow | null>(null);
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => {
      if (node.clientWidth)
        setColumnCount(
          Math.max(1, Math.min(4, Math.floor((node.clientWidth - 280) / 240))),
        );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [frameRef]);
  const filtered = rows.filter(
    (r) =>
      (!onlyShortage || r.priorityRequired) &&
      [r.skuCode, r.name]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    currentPage = Math.min(page, pages - 1);
  const recipients = [
    ...new Map(
      rows.flatMap((r) => r.cells.map((c) => [c.toBranchId, c.name] as const)),
    ),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const recipientPages = Math.max(
      1,
      Math.ceil(recipients.length / columnCount),
    ),
    currentRecipientPage = Math.min(recipientPage, recipientPages - 1);
  const columns = recipients.slice(
    currentRecipientPage * columnCount,
    (currentRecipientPage + 1) * columnCount,
  );
  const unresolved = rows.filter((r) => r.priorityRequired).length;
  const disabled = stale || saving;
  const submit = (command: DonorPlanCommand) => {
    void onEdit(command).catch(() => undefined);
  };
  return createPortal(
    <div
      className="drawer-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={ref}
        tabIndex={-1}
        className="drawer transfer-drawer donor-allocation-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Приоритеты донора ${name}`}
      >
        <div className="drawer-head">
          <div className="transfer-heading">
            <p className="eyebrow">Приоритеты перемещений</p>
            <h2>{name}</h2>
            <p>
              {rows.length} SKU · Нужны приоритеты: {unresolved}
            </p>
          </div>
          <button className="close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="donor-mode-bar">
          <label>
            Распределение между выбранными
            <select
              className="input"
              aria-label="Распределение между выбранными"
              value={mode}
              disabled={disabled}
              onChange={(e) =>
                submit({
                  kind: 'mode',
                  fromBranchId,
                  mode: e.target.value as DonorSplitMode,
                })
              }
            >
              <option value="PROPORTIONAL">Пропорционально потребности</option>
              <option value="EQUAL">Поровну</option>
            </select>
          </label>
          <p>
            Флажки задают приоритет. Смена флажков пересчитывает строку и
            сбрасывает её ручные количества. Ручные строки сохраняются при смене
            режима.
          </p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {stale && (
          <Alert tone="warning">
            Условия изменились. Закройте карточку и рассчитайте перемещения
            заново.
          </Alert>
        )}
        <div className="filters compact-filters donor-matrix-tools">
          <label>
            Поиск товара
            <SearchInput
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(0);
              }}
            />
          </label>
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={onlyShortage}
              onChange={(e) => {
                setOnlyShortage(e.target.checked);
                setPage(0);
              }}
            />
            Нужны приоритеты
          </label>
          <nav className="transfer-pagination" aria-label="Страницы товаров">
            <Button
              className="secondary"
              aria-label="Предыдущие товары"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              ‹
            </Button>
            <span>
              {filtered.length ? currentPage * pageSize + 1 : 0}–
              {Math.min((currentPage + 1) * pageSize, filtered.length)} из{' '}
              {filtered.length} SKU
            </span>
            <Button
              className="secondary"
              aria-label="Следующие товары"
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </Button>
          </nav>
          <nav
            className="transfer-pagination"
            aria-label="Страницы получателей"
          >
            <Button
              className="secondary"
              aria-label="Предыдущие получатели"
              disabled={currentRecipientPage === 0}
              onClick={() => setRecipientPage(currentRecipientPage - 1)}
            >
              ‹
            </Button>
            <span>
              Получатели{' '}
              {recipients.length ? currentRecipientPage * columnCount + 1 : 0}–
              {Math.min(
                (currentRecipientPage + 1) * columnCount,
                recipients.length,
              )}{' '}
              из {recipients.length}
            </span>
            <Button
              className="secondary"
              aria-label="Следующие получатели"
              disabled={currentRecipientPage >= recipientPages - 1}
              onClick={() => setRecipientPage(currentRecipientPage + 1)}
            >
              ›
            </Button>
          </nav>
        </div>
        <div className="transfer-table-frame" ref={frameRef}>
          <VirtualTable
            rows={filtered.slice(
              currentPage * pageSize,
              (currentPage + 1) * pageSize,
            )}
            getRowKey={(r) => r.skuCode}
            maxHeight="100%"
            emptyMessage="Нет товаров по выбранному фильтру."
            columns={[
              {
                key: 'sku',
                header: 'Товар · запас донора · общий план',
                width: 'minmax(240px, 1.15fr)',
                render: (r) => (
                  <div
                    className={`donor-sku ${r.priorityRequired ? 'needs-priorities' : ''}`}
                  >
                    <strong>
                      {r.skuCode}{' '}
                      <span className="donor-status">
                        {r.priorityRequired
                          ? 'Нужны приоритеты'
                          : r.decisionMode === 'MANUAL'
                            ? 'Вручную'
                            : r.decisionMode === 'PRIORITY'
                              ? 'Приоритеты заданы'
                              : 'Автоматически'}
                      </span>
                    </strong>
                    <button
                      className="transfer-product-name"
                      aria-label={`Показать товар ${r.skuCode}`}
                      onClick={() => setProduct(r)}
                    >
                      {r.name}
                    </button>
                    <small>
                      По отчёту {fmtQty(r.stock)} · MAX {fmtQty(r.max)} ·
                      Принято {fmtQty(r.acceptedOutgoing)}
                    </small>
                    <strong>
                      Доступно {fmtQty(r.availableQty)} · План{' '}
                      {fmtQty(r.plannedQty)} {r.unit}
                    </strong>
                    <span>
                      После всех отправлений: <b>{fmtQty(r.after)}</b> · не ниже{' '}
                      {fmtQty(r.max)}
                    </span>
                  </div>
                ),
              },
              ...columns.map(([to, recipientName]) => ({
                key: to,
                header: recipientName,
                width: 'minmax(0, 1fr)',
                render: (r: DonorAllocationRow) => {
                  const c = r.cells.find((c) => c.toBranchId === to);
                  if (!c)
                    return (
                      <span className="muted">
                        Нет потребности или прямого маршрута
                      </span>
                    );
                  return (
                    <div className="donor-receiver">
                      <strong>
                        Потребность: {fmtQty(c.need)} {r.unit}
                      </strong>
                      <small>
                        Остаток {fmtQty(c.stock)} · MIN {fmtQty(c.min)} · MAX{' '}
                        {fmtQty(c.max)}
                        {c.target !== c.max
                          ? ` · Цель ${fmtQty(c.target)}`
                          : ''}
                      </small>
                      <small>
                        Принятый вход {fmtQty(c.acceptedIncoming)} · План других{' '}
                        {fmtQty(c.otherPlanned)}
                      </small>
                      {c.locked ? (
                        <strong className="success">
                          Принято: {fmtQty(c.acceptedQty)} {r.unit} ·
                          зафиксировано
                        </strong>
                      ) : (
                        <div className="donor-cell-inputs">
                          <label className="checkbox-control">
                            <input
                              type="checkbox"
                              aria-label={`Приоритет ${r.skuCode} ${recipientName}`}
                              checked={c.priority}
                              disabled={disabled || !c.canAllocate}
                              onChange={(e) =>
                                submit({
                                  kind: 'priorities',
                                  skuCode: r.skuCode,
                                  fromBranchId,
                                  recipientIds: r.cells
                                    .filter((v) =>
                                      v.toBranchId === to
                                        ? e.target.checked
                                        : v.priority,
                                    )
                                    .map((v) => v.toBranchId),
                                })
                              }
                            />
                            Приоритет
                          </label>
                          <label>
                            Переместить
                            <QuantityInput
                              aria-label={`Переместить ${r.skuCode} ${recipientName}`}
                              value={c.qty}
                              step={r.step}
                              disabled={stale || !c.canAllocate}
                              onCommit={(qty) =>
                                onEdit({
                                  kind: 'quantity',
                                  skuCode: r.skuCode,
                                  fromBranchId,
                                  toBranchId: to,
                                  qty,
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                      <small>
                        Шаг {fmtQty(r.step)} {r.unit}
                      </small>
                    </div>
                  );
                },
              })),
            ]}
          />
        </div>
        <div className="drawer-actions transfer-drawer-actions">
          <div className="transfer-selection-summary">
            <strong>{saving ? 'Сохраняем план…' : 'План сохранён'}</strong>
            <span>В заказы попадут только принятые перемещения.</span>
          </div>
          <div className="transfer-action-buttons">
            <Button className="secondary" onClick={onClose}>
              Готово
            </Button>
            <Button disabled={disabled} onClick={onResults}>
              К принятию перемещений
            </Button>
          </div>
        </div>
        {product && (
          <Dialog
            title={`Товар ${product.skuCode}`}
            onClose={() => setProduct(null)}
          >
            <p>{product.name}</p>
            <p>
              Единица: {product.unit}. Шаг: {fmtQty(product.step)}.
            </p>
          </Dialog>
        )}
      </aside>
    </div>,
    document.body,
  );
}
