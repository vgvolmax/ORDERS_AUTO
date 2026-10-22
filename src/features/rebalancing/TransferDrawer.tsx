import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../../components/Dialog';
import { VirtualTable } from '../../components/VirtualTable';
import { Alert, Button, SearchInput } from '../../components/ui';
import { fmtQty, money } from '../demand/DemandPage';
import type {
  TransferDocument,
  TransferDocumentLine,
  TransferStockView,
} from './transferDocuments';

export function TransferDrawer({
  document: doc,
  selected,
  onSelection,
  onReject,
  onRevoke,
  onAccept,
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
  onClose: () => void;
  stale: boolean;
  busy: boolean;
  saving: boolean;
  error: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useModalLayer(ref, onClose);
  const [query, setQuery] = useState('');
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
          <div>
            <p className="eyebrow">Состав перемещения</p>
            <h2>
              {doc.fromName} → {doc.toName}
            </h2>
            <p>
              {doc.skuCount} SKU ·{' '}
              {doc.totalAmount === null
                ? 'Сумма неизвестна'
                : money(doc.totalAmount)}
            </p>
            <p>
              Количество рассчитано автоматически. Предложения учитываются в
              заказах только после принятия.
            </p>
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
        <div className="filters compact-filters">
          <label>
            Поиск по составу перемещения
            <SearchInput value={query} onValueChange={setQuery} />
          </label>
          <label className="checkbox-control">
            <input
              type="checkbox"
              aria-label="Выбрать видимые предложения"
              checked={
                eligible.length > 0 && routeSelected.length === eligible.length
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
            Отметить видимые ({eligible.length})
          </label>
          <span>
            Показано позиций: {rows.length} из {doc.lines.length}
          </span>
        </div>
        <p className="transfer-stock-help">
          Предложено: остаток с уже принятыми перемещениями → остаток после
          принятия только этой строки. Принято: остаток по отчёту → остаток со
          всеми принятыми перемещениями. Цена — справочная MIN/MAX; отклонённые
          строки не входят в сумму.
        </p>
        <VirtualTable
          rows={rows}
          maxHeight="min(55vh, 600px)"
          getRowKey={(l) => l.id}
          emptyMessage={
            doc.lines.length
              ? 'Нет позиций по выбранному поиску.'
              : 'В этом направлении больше нет позиций.'
          }
          columns={[
            {
              key: 'check',
              header: 'Выбор',
              width: '70px',
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
            {
              key: 'product',
              header: 'Код · артикул · товар',
              width: 'minmax(250px, 1fr)',
              className: 'transfer-product',
              render: (l) => (
                <>
                  <strong>{l.skuCode}</strong>
                  <span>{l.article ?? 'Артикул не указан'}</span>
                  <span>{l.name}</span>
                </>
              ),
            },
            {
              key: 'from',
              header: 'Отправитель · остаток',
              width: '190px',
              render: (l) => <Stock values={l.from} line={l} />,
            },
            {
              key: 'to',
              header: 'Получатель · остаток',
              width: '190px',
              render: (l) => <Stock values={l.to} line={l} />,
            },
            {
              key: 'qty',
              header: 'К перемещению',
              width: '140px',
              className: 'num',
              render: (l) => (
                <strong>
                  {fmtQty(l.qty)} {l.unit ?? 'единица не задана'}
                </strong>
              ),
            },
            {
              key: 'price',
              header: 'Цена MIN/MAX',
              width: '130px',
              className: 'num',
              render: (l) =>
                l.unitPrice === null ? 'Нет цены' : money(l.unitPrice),
            },
            {
              key: 'amount',
              header: 'Сумма',
              width: '130px',
              className: 'num',
              render: (l) =>
                l.amount === null ? 'Неизвестна' : money(l.amount),
            },
            {
              key: 'decision',
              header: 'Решение',
              width: '180px',
              render: (l) => (
                <div className="transfer-line-actions">
                  <span className={l.decision === 'ACCEPTED' ? 'success' : ''}>
                    {l.decision === 'ACCEPTED'
                      ? 'Принято'
                      : l.decision === 'REJECTED'
                      ? 'Отклонено'
                      : 'Предложено'}
                  </span>
                  {l.transferId ? (
                    <button
                      className="link"
                      disabled={busy || saving}
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
        <div className="drawer-actions">
          <Button className="secondary" onClick={onClose}>
            Закрыть карточку
          </Button>
          <Button
            disabled={disabled || saving || !routeSelected.length}
            onClick={() => onAccept(routeSelected)}
          >
            Принять выбранные в перемещении ({routeSelected.length})
          </Button>
        </div>
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
