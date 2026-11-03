import { useEffect, useMemo, useState } from 'react';
import { VirtualTable, type TableSort } from '../../components/VirtualTable';
import { Dialog } from '../../components/Dialog';
import { productColumns } from '../../components/productColumns';
import {
  Alert,
  Button,
  EmptyState,
  SearchInput,
  Select,
} from '../../components/ui';
import { fmtQty, money } from '../../format/numbers';
import type { AcceptedTransferFilters } from '../../domain/workspace';
import {
  summarizeTransferDocuments,
  type TransferDocument,
  type TransferDocumentLine,
} from './transferDocuments';
import {
  emptyAcceptedFilters,
  filterAcceptedDocuments,
} from './acceptedTransfersViewModel';

export function AcceptedTransfersView({
  documents,
  filters,
  onFilters,
  onExport,
}: {
  documents: TransferDocument[];
  filters: AcceptedTransferFilters;
  onFilters: (filters: AcceptedTransferFilters) => void | Promise<void>;
  onExport: (ids: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [exportError, setExportError] = useState('');
  function exportCsv(ids: string[]) {
    setExportError('');
    try {
      onExport(ids);
    } catch {
      setExportError(
        'Не удалось скачать CSV принятых перемещений. Повторите выгрузку.',
      );
    }
  }
  const byId = useMemo(
    () => new Map(documents.map((d) => [d.id, d])),
    [documents],
  );
  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => byId.has(id)));
  }, [byId]);
  const selected = selectedIds.filter((id) => byId.has(id));
  const selectedSet = new Set(selected);
  const visible = useMemo(
    () => filterAcceptedDocuments(documents, filters),
    [documents, filters],
  );
  const visibleIds = new Set(visible.map((d) => d.id));
  const hiddenCount = selected.filter((id) => !visibleIds.has(id)).length;
  const allVisible =
    visible.length > 0 && visible.every((d) => selectedSet.has(d.id));
  const summary = summarizeTransferDocuments(visible);
  const activeFilters = Boolean(
    filters.query || filters.fromBranchId || filters.toBranchId,
  );
  const opened = openedId ? byId.get(openedId) : null;
  function options(side: 'from' | 'to') {
    return [
      ...new Map(
        documents.map((d) =>
          side === 'from'
            ? [d.fromBranchId, d.fromName]
            : [d.toBranchId, d.toName],
        ),
      ).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }
  const fromOptions = options('from'),
    toOptions = options('to');
  return (
    <section className="accepted-transfers" aria-label="Принятые перемещения">
      <div className="section-heading">
        <h2>Принятые перемещения · {documents.length}</h2>
        <span className="muted">
          Направлений по фильтрам: {visible.length} ·{' '}
          {summary.acceptedAmount === null
            ? 'Сумма неизвестна'
            : money(summary.acceptedAmount)}
        </span>
      </div>
      <div
        className="accepted-filters"
        role="group"
        aria-label="Фильтры принятых перемещений"
      >
        <label>
          Поиск
          <SearchInput
            aria-label="Поиск принятых перемещений"
            placeholder="Код, артикул, товар или направление"
            value={filters.query}
            onValueChange={(query) => onFilters({ ...filters, query })}
          />
        </label>
        <label>
          Отправитель
          <Select
            aria-label="Отправитель принятых"
            value={filters.fromBranchId}
            onChange={(e) =>
              onFilters({ ...filters, fromBranchId: e.target.value })
            }
          >
            <option value="">Все отправители</option>
            {filters.fromBranchId &&
              !fromOptions.some(([id]) => id === filters.fromBranchId) && (
                <option value={filters.fromBranchId}>
                  Нет принятых у выбранного отправителя
                </option>
              )}
            {fromOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          Получатель
          <Select
            aria-label="Получатель принятых"
            value={filters.toBranchId}
            onChange={(e) =>
              onFilters({ ...filters, toBranchId: e.target.value })
            }
          >
            <option value="">Все получатели</option>
            {filters.toBranchId &&
              !toOptions.some(([id]) => id === filters.toBranchId) && (
                <option value={filters.toBranchId}>
                  Нет принятых у выбранного получателя
                </option>
              )}
            {toOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <Button
          className="secondary"
          aria-label="Сбросить фильтры принятых"
          disabled={!activeFilters}
          onClick={() => onFilters(emptyAcceptedFilters)}
        >
          Сбросить
        </Button>
      </div>
      <div className="accepted-toolbar">
        <label className="checkbox-control">
          <input
            type="checkbox"
            aria-label="Выбрать все направления по фильтрам"
            checked={allVisible}
            disabled={!visible.length}
            onChange={(e) =>
              setSelectedIds(
                e.target.checked
                  ? [...new Set([...selected, ...visible.map((d) => d.id)])]
                  : selected.filter((id) => !visibleIds.has(id)),
              )
            }
          />
          Выбрать по фильтрам ({visible.length})
        </label>
        <span>
          Выбрано: {selected.length}
          {hiddenCount > 0 && ` · Скрыто фильтрами: ${hiddenCount}`}
        </span>
        <Button
          className="secondary"
          disabled={!selected.length}
          onClick={() => setSelectedIds([])}
        >
          Снять выбор
        </Button>
        <Button disabled={!selected.length} onClick={() => exportCsv(selected)}>
          CSV выбранных ({selected.length})
        </Button>
      </div>
      <p className="accepted-export-help">
        Поиск отбирает направления. CSV содержит все принятые товары выбранных
        направлений, включая скрытые поиском.
      </p>
      {exportError && !opened && <Alert tone="danger">{exportError}</Alert>}
      {!documents.length ? (
        <EmptyState>
          Принятых перемещений пока нет. Примите предложения на вкладке
          «Результаты».
        </EmptyState>
      ) : (
        <div className="accepted-table-frame">
          <VirtualTable
            rows={visible}
            getRowKey={(d) => d.id}
            maxHeight="100%"
            estimateRowHeight={58}
            sort={sort}
            onSortChange={setSort}
            emptyMessage="Нет принятых перемещений по выбранным фильтрам. Измените или сбросьте фильтры."
            columns={[
              {
                key: 'select',
                header: 'Выбор',
                width: '60px',
                render: (d) => (
                  <input
                    type="checkbox"
                    aria-label={`Выбрать ${d.fromName} → ${d.toName}`}
                    checked={selectedSet.has(d.id)}
                    onChange={(e) =>
                      setSelectedIds(
                        e.target.checked
                          ? [...selected, d.id]
                          : selected.filter((id) => id !== d.id),
                      )
                    }
                  />
                ),
              },
              {
                key: 'from',
                header: 'Отправитель',
                width: 'minmax(150px,1fr)',
                sortValue: (d) => d.fromName,
                render: (d) => <strong>{d.fromName}</strong>,
              },
              {
                key: 'to',
                header: 'Получатель',
                width: 'minmax(150px,1fr)',
                sortValue: (d) => d.toName,
                render: (d) => <strong>{d.toName}</strong>,
              },
              {
                key: 'amount',
                header: 'Сумма',
                width: '150px',
                sortValue: (d) => d.totalAmount,
                render: (d) =>
                  d.totalAmount === null
                    ? 'Сумма неизвестна'
                    : money(d.totalAmount),
              },
              {
                key: 'sku',
                header: 'Состав',
                width: '115px',
                render: (d) => (
                  <button
                    className="link"
                    aria-label={`Состав ${d.fromName} → ${d.toName}`}
                    onClick={() => setOpenedId(d.id)}
                  >
                    {d.skuCount} SKU
                  </button>
                ),
              },
              {
                key: 'csv',
                header: 'CSV',
                width: '85px',
                render: (d) => (
                  <Button
                    className="secondary"
                    aria-label={`CSV ${d.fromName} → ${d.toName}`}
                    onClick={() => exportCsv([d.id])}
                  >
                    CSV
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
      {opened && (
        <Dialog
          title={`Принято: ${opened.fromName} → ${opened.toName}`}
          onClose={() => setOpenedId(null)}
          actions={
            <>
              <Button className="secondary" onClick={() => setOpenedId(null)}>
                Закрыть
              </Button>
              <Button onClick={() => exportCsv([opened.id])}>
                Скачать CSV направления
              </Button>
            </>
          }
        >
          {exportError && <Alert tone="danger">{exportError}</Alert>}
          <p>
            {opened.skuCount} SKU ·{' '}
            {opened.totalAmount === null
              ? 'Сумма неизвестна'
              : money(opened.totalAmount)}
          </p>
          <VirtualTable
            rows={opened.lines}
            getRowKey={(l) => l.id}
            maxHeight="min(50dvh, 480px)"
            columns={[
              ...productColumns<TransferDocumentLine>((l) => ({
                code: l.skuCode,
                article: l.article,
                name: l.name,
              })),
              {
                key: 'qty',
                header: 'Принято',
                width: '110px',
                render: (l) => `${fmtQty(l.qty)} ${l.unit ?? ''}`,
              },
              {
                key: 'amount',
                header: 'Сумма',
                width: '140px',
                render: (l) =>
                  l.amount === null ? 'Сумма неизвестна' : money(l.amount),
              },
            ]}
          />
        </Dialog>
      )}
    </section>
  );
}
