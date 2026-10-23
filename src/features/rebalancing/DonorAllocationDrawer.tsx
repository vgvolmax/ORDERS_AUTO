import { useDurableDraft } from '../../app/useDurableDraft';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, useModalLayer } from '../../components/Dialog';
import { VirtualList } from '../../components/VirtualList';
import {
  DonorAllocationCard,
  type DonorRecipient,
} from './DonorAllocationCard';
import { Alert, Button, SearchInput } from '../../components/ui';
import type { DonorPlanCommand } from '../../app/rebalanceActions';
import type { DonorAllocationRow } from '../../domain/rebalancing/allocationPlan';
import type { DonorSplitMode } from '../../domain/rebalancing/types';
import { fmtQty } from '../demand/DemandPage';

export function DonorAllocationDrawer({
  name,
  fromBranchId,
  rows,
  recipients,
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
  recipients: DonorRecipient[];
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
  const [query, setQuery] = useState(''),
    [onlyShortage, setOnlyShortage] = useState(false);
  const [product, setProduct] = useState<DonorAllocationRow | null>(null);
  const filtered = rows.filter(
    (r) =>
      (!onlyShortage || r.priorityRequired) &&
      [r.skuCode, r.name]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const unresolved = rows.filter((r) => r.priorityRequired).length;
  const disabled = stale || saving;
  const [modeDraft, changeMode] = useDurableDraft(mode, fromBranchId, (next) =>
    onEdit({ kind: 'mode', fromBranchId, mode: next }),
  );
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
              value={modeDraft}
              disabled={disabled}
              onChange={(e) => changeMode(e.target.value as DonorSplitMode)}
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
              }}
            />
          </label>
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={onlyShortage}
              onChange={(e) => {
                setOnlyShortage(e.target.checked);
              }}
            />
            Нужны приоритеты
          </label>
          <span className="donor-result-count" role="status">
            {filtered.length} из {rows.length} SKU · {recipients.length}{' '}
            подразделений
          </span>
        </div>
        <div className="donor-allocation-list">
          <VirtualList
            items={filtered}
            getItemKey={(row) => row.skuCode}
            label="Список перемещений донора"
            resetKey={`${query}:${onlyShortage}`}
            emptyMessage="Нет товаров по выбранному фильтру."
            renderItem={(row) => (
              <DonorAllocationCard
                row={row}
                recipients={recipients}
                disabled={disabled}
                stale={stale}
                onEdit={onEdit}
                onProduct={() => setProduct(row)}
              />
            )}
          />
        </div>
        <div className="drawer-actions transfer-drawer-actions">
          <div className="transfer-selection-summary">
            <strong>
              {saving
                ? 'Сохраняем план…'
                : error
                  ? 'Последняя правка не сохранена'
                  : 'План сохранён'}
            </strong>
            <span>
              {rows.some((r) =>
                r.cells.some(
                  (c) => c.rejectedQty > 0 || c.otherPlannedRejected > 0,
                ),
              )
                ? 'Прогноз включает отклонённые предложения. К принятию они не отмечаются.'
                : 'В заказы попадут только принятые перемещения.'}
            </span>
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
