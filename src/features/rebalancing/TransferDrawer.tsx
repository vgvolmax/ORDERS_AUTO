import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, useModalLayer } from '../../components/Dialog';
import { VirtualTable } from '../../components/VirtualTable';
import { productColumns } from '../../components/productColumns';
import { Alert, Button, SearchInput } from '../../components/ui';
import { fmtQty, money } from '../demand/DemandPage';
import type {
  TransferDocument,
  TransferDocumentLine,
  TransferStockView,
} from './transferDocuments';
import { summarizeTransferDocuments } from './transferDocuments';

export function TransferDrawer({
  document: doc,
  selected,
  onSelection,
  onReject,
  onRevoke,
  onAccept,
  onExport,
  exportCount,
  onClose,
  stale,
  busy,
  saving,
  error,
}: {
  document: TransferDocument;
  selected: string[];
  onSelection: (ids: string[]) => void;
  onReject: (id: string) => void;
  onRevoke: (id: string) => void;
  onAccept: (ids: string[]) => void;
  onExport: () => void;
  exportCount: number;
  onClose: () => void;
  stale: boolean;
  busy: boolean;
  saving: boolean;
  error: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useModalLayer(ref, onClose);
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState<TransferDocumentLine | null>(null);
  const rows = doc.lines.filter((l) =>
    [l.skuCode, l.article ?? '', l.name]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const eligible = rows.filter((l) => l.decision === 'PROPOSED');
  const routeSelected = eligible
    .filter((l) => l.selected)
    .map((l) => l.sourceLineId);
  const disabled = stale || busy;
  const summary = summarizeTransferDocuments([doc]);
  const selectedAmount = summarizeTransferDocuments([
    { ...doc, lines: eligible.filter((line) => line.selected) },
  ]).totalAmount;
  const amount = (value: number | null) =>
    value === null ? 'Сумма неизвестна' : money(value);
  return createPortal(
    <div
      className="drawer-back"
      role="presentation"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <aside
        ref={ref}
        tabIndex={-1}
        className="drawer transfer-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Состав перемещения"
      >
        <div className="drawer-head">
          <div className="transfer-heading">
            <p className="eyebrow">Состав перемещения</p>
            <h2>
              {doc.fromName} → {doc.toName}
            </h2>
            <p>
              {doc.skuCount} SKU · Принято строк: {summary.acceptedCount} из{' '}
              {summary.activeCount}
            </p>
          </div>
          <div className="transfer-financial-summary">
            <div aria-label="Сумма перемещения">
              <small>Всего в перемещении</small>
              <strong>{amount(summary.totalAmount)}</strong>
            </div>
            <div aria-label="Принято на сумму в перемещении">
              <small>Принято в перемещении</small>
              <strong>{amount(summary.acceptedAmount)}</strong>
            </div>
            <div aria-label="Выбрано на сумму в перемещении">
              <small>Выбрано по поиску · {routeSelected.length} поз.</small>
              <strong>{amount(selectedAmount)}</strong>
            </div>
          </div>
          <button className="close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        {stale && (
          <Alert tone="warning">
            Предложения устарели. Закройте карточку и рассчитайте перемещения
            заново. Принятые строки продолжают учитываться.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="filters compact-filters transfer-toolbar">
          <label>
            Поиск
            <SearchInput
              aria-label="Поиск по составу перемещения"
              placeholder="Код, артикул или наименование"
              value={query}
              onValueChange={(value) => {
                setQuery(value);
              }}
            />
          </label>
          <label className="checkbox-control">
            <input
              type="checkbox"
              aria-label="Выбрать все предложения по поиску"
              checked={
                eligible.length > 0 && eligible.every((line) => line.selected)
              }
              disabled={disabled || !eligible.length}
              onChange={(e) => {
                const ids = new Set(eligible.map((l) => l.sourceLineId));
                onSelection(
                  e.target.checked
                    ? [...new Set([...selected, ...ids])]
                    : selected.filter((id) => !ids.has(id)),
                );
              }}
            />
            Отметить все по поиску ({eligible.length})
          </label>
          <span aria-live="polite">Позиций по поиску: {rows.length}</span>
        </div>
        <p className="transfer-stock-help">
          Предложено: сейчас → после строки. Принято: по отчёту → с принятыми.
          Цена MIN/MAX — справочная.
        </p>
        <div className="transfer-table-frame">
          <VirtualTable
            rows={rows}
            estimateRowHeight={88}
            maxHeight="100%"
            getRowKey={(l) => l.id}
            emptyMessage={
              doc.lines.length
                ? 'Нет позиций по выбранному поиску.'
                : 'В этом направлении больше нет позиций.'
            }
            columns={[
              {
                key: 'check',
                header: '',
                width: '36px',
                render: (l) =>
                  l.decision === 'ACCEPTED' ? (
                    '—'
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={[
                        'Выбрать перемещение',
                        l.skuCode,
                        doc.fromName,
                        '→',
                        doc.toName,
                      ].join(' ')}
                      checked={l.selected}
                      disabled={disabled || l.decision === 'REJECTED'}
                      onChange={(e) =>
                        onSelection(
                          e.target.checked
                            ? [...new Set([...selected, l.sourceLineId])]
                            : selected.filter((id) => id !== l.sourceLineId),
                        )
                      }
                    />
                  ),
              },
              ...productColumns<TransferDocumentLine>(
                (l) => ({ code: l.skuCode, article: l.article, name: l.name }),
                {
                  code: { width: '130px' },
                  article: { width: '110px' },
                  name: {
                    width: 'minmax(200px,1.5fr)',
                    render: (l) => (
                      <button
                        className="transfer-product-name"
                        aria-label={`Показать полное название ${l.skuCode}`}
                        onClick={() => setProduct(l)}
                      >
                        {l.name}
                      </button>
                    ),
                  },
                },
              ),
              {
                key: 'from',
                header: 'Отправитель · остаток',
                width: 'minmax(155px, 1fr)',
                render: (l) => <Stock values={l.from} line={l} />,
              },
              {
                key: 'to',
                header: 'Получатель · остаток',
                width: 'minmax(155px, 1fr)',
                render: (l) => <Stock values={l.to} line={l} />,
              },
              {
                key: 'cost',
                header: 'Количество · цена · сумма',
                width: 'minmax(155px, 1fr)',
                className: 'transfer-cost num',
                render: (l) => (
                  <>
                    <strong>{fmtQty(l.qty)}</strong>
                    <small>Ед. изм.: {l.unit ?? 'ед.'}</small>
                    <small>
                      Цена:{' '}
                      {l.unitPrice === null ? 'Нет цены' : money(l.unitPrice)}
                    </small>
                    <span>
                      {l.amount === null ? 'Сумма неизвестна' : money(l.amount)}
                    </span>
                  </>
                ),
              },
              {
                key: 'decision',
                header: 'Решение',
                width: 'minmax(125px, 1fr)',
                render: (l) => (
                  <div className="transfer-line-actions">
                    <span
                      className={l.decision === 'ACCEPTED' ? 'success' : ''}
                    >
                      {l.decision === 'ACCEPTED'
                        ? 'Принято'
                        : l.decision === 'REJECTED'
                          ? 'Отклонено'
                          : 'Предложено'}
                    </span>
                    {l.transferId ? (
                      <button
                        className="link"
                        disabled={busy}
                        aria-label={[
                          'Отменить принятие',
                          l.skuCode,
                          doc.fromName,
                          '→',
                          doc.toName,
                        ].join(' ')}
                        onClick={() => onRevoke(l.transferId!)}
                      >
                        Отменить принятие
                      </button>
                    ) : (
                      <button
                        className="link"
                        disabled={busy}
                        onClick={() => onReject(l.sourceLineId)}
                      >
                        {l.decision === 'REJECTED' ? 'Вернуть' : 'Отклонить'}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
        <p className="transfer-scope-note">
          Принятие — все отмеченные позиции текущего поиска, включая строки за
          пределами экрана. CSV — принятые позиции всего перемещения.
        </p>
        <div className="drawer-actions transfer-drawer-actions">
          <div className="transfer-selection-summary">
            <strong>Выбрано к принятию: {routeSelected.length}</strong>
            <span>{amount(selectedAmount)}</span>
            {saving && <small role="status">Сохраняем выбор…</small>}
          </div>
          <div className="transfer-action-buttons">
            <Button
              className="secondary"
              aria-label={`Скачать CSV принятых позиций (${exportCount})`}
              disabled={busy || !exportCount}
              onClick={onExport}
            >
              CSV принятых ({exportCount})
            </Button>
            <Button
              className="secondary"
              aria-label="Закрыть карточку"
              onClick={onClose}
            >
              Закрыть
            </Button>
            <Button
              disabled={disabled || !routeSelected.length}
              aria-label={`Принять выбранные в перемещении (${routeSelected.length})`}
              onClick={() => onAccept(routeSelected)}
            >
              {busy
                ? 'Подготовка…'
                : `Принять выбранные (${routeSelected.length})`}
            </Button>
          </div>
        </div>
        {product && (
          <Dialog
            title={`Товар ${product.skuCode}`}
            onClose={() => setProduct(null)}
          >
            <dl className="transfer-product-details">
              <dt>Код1С</dt>
              <dd>{product.skuCode}</dd>
              <dt>Артикул</dt>
              <dd>{product.article ?? 'Не указан'}</dd>
              <dt>Наименование</dt>
              <dd>{product.name}</dd>
            </dl>
          </Dialog>
        )}
      </aside>
    </div>,
    document.body,
  );
}
function Stock({
  values,
  line,
}: {
  values: TransferStockView | null;
  line: TransferDocumentLine;
}) {
  if (!values) return <span>Нет данных снимка</span>;
  return (
    <div className="transfer-stock">
      <strong>
        {fmtQty(
          line.decision === 'ACCEPTED' ? values.physical : values.current,
        )}{' '}
        → {fmtQty(values.afterLine)}
      </strong>
      <small>
        MIN {values.min === null ? '—' : fmtQty(values.min)} · MAX{' '}
        {values.max === null ? '—' : fmtQty(values.max)}
      </small>
      {line.decision !== 'ACCEPTED' && (
        <small>По отчёту: {fmtQty(values.physical)}</small>
      )}
    </div>
  );
}
