import { useMemo, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { stockStatusLabels } from '../../components/StatusBadge';
import { Alert, Button, Input, Select } from '../../components/ui';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import {
  invoiceHistoryStatuses, lastClosedInvoiceHistory, type InvoiceHistoryRecord, type InvoiceHistoryStatus,
} from '../../domain/invoiceHistory';
import {
  decodeInvoiceHistory, encodeInvoiceHistory, previewInvoiceHistory,
} from '../../domain/invoiceHistoryBackup';
import {
  summarizeInvoiceHistory, type InvoiceHistoryDetail, type InvoiceHistoryFilters, type InvoiceHistorySummary, type InvoiceHistoryView,
} from '../../domain/invoiceHistoryReport';
import { save } from '../../export/download';
import { fmtQty } from '../../format/numbers';
import { loadInvoiceHistory, restoreInvoiceHistory } from '../../persistence/invoiceHistory';

const labels: Record<InvoiceHistoryStatus, string> = { ...stockStatusLabels, unknown: 'Статус неизвестен' };
const outcomeLabels = { covered: 'Покрыто', full: 'Полный отказ', partial: 'Частичный отказ', removed: 'Сняли мы' };
const rankings = {
  belowMin: 'Отказы при остатке ниже MIN', share: 'Доля заказов с отказами',
  full: 'Полные отказы', partial: 'Частичные отказы', affectedOrders: 'Заказы с отказами',
};
type Ranking = keyof typeof rankings;
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU');

export function InvoiceHistoryPanel({ records, onRefresh, onOpen }: {
  records: InvoiceHistoryRecord[];
  onRefresh: (records: InvoiceHistoryRecord[]) => void;
  onOpen: (record: InvoiceHistoryRecord) => void;
}) {
  const [view, setView] = useState<InvoiceHistoryView>('supplier');
  const [filters, setFilters] = useState<InvoiceHistoryFilters>({});
  const [ranking, setRanking] = useState<Ranking>('belowMin');
  const [minimum, setMinimum] = useState('');
  const [detail, setDetail] = useState<InvoiceHistorySummary | null>(null);
  const [restore, setRestore] = useState<InvoiceHistoryRecord[] | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const identities = useMemo(() => ({
    suppliers: summarizeInvoiceHistory(records, 'supplier', {}).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    skus: summarizeInvoiceHistory(records, 'sku', {}).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })),
  }), [records]);
  const summaries = useMemo(() => summarizeInvoiceHistory(records, view, filters)
    .filter((row) => row.orders >= Math.max(0, Number(minimum) || 0))
    .sort((a, b) => b[ranking] - a[ranking] || b.affectedOrders - a.affectedOrders ||
      b.orders - a.orders || a.name.localeCompare(b.name, 'ru', { numeric: true })), [records, view, filters, minimum, ranking]);
  const preview = restore ? previewInvoiceHistory(records, restore) : null;
  const reopened = records.filter((record) => record.revisions.at(-1)?.kind === 'reopened');
  const openBreakdown = (row: InvoiceHistorySummary) => {
    if (filters.inn && filters.sku) setDetail(row);
    else if (view === 'supplier') {
      setFilters({ ...filters, inn: row.key });
      setView('sku');
    } else {
      setFilters({ ...filters, sku: row.key });
      setView('supplier');
    }
  };

  const columns: VirtualColumn<InvoiceHistorySummary>[] = [
    { key: 'identity', header: view === 'supplier' ? 'Юрлицо поставщика' : 'Артикул', width: 'minmax(158px, 1.2fr)',
      render: (row) => <div className="invoice-identity">
        <button className="invoice-history-link" type="button" onClick={() => openBreakdown(row)}>{row.name}</button>
        <small>{view === 'supplier' ? `ИНН ${row.sublabel}` : row.sublabel}</small>
      </div> },
    { key: 'orders', header: 'Заказов', width: '70px', className: 'num', render: (row) => fmtQty(row.orders) },
    { key: 'full', header: 'Полные отказы', width: '84px', className: 'num', render: (row) => fmtQty(row.full) },
    { key: 'partial', header: 'Частичные', width: '85px', className: 'num', render: (row) => fmtQty(row.partial) },
    { key: 'share', header: 'Заказы с отказами', width: '104px', className: 'num', render: (row) => <>
      <strong>{(row.share * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</strong>
      <small>{fmtQty(row.affectedOrders)} из {fmtQty(row.orders)}</small>
    </> },
    ...(view === 'supplier' ? [{ key: 'skus', header: 'Артикулов с отказами', width: '100px', className: 'num',
      render: (row: InvoiceHistorySummary) => fmtQty(row.affectedSkus) }] : []),
    { key: 'missing', header: 'Не выставлено', width: '100px', className: 'num', render: (row) =>
      Object.entries(row.shortage).map(([unit, qty]) => `${fmtQty(qty)} ${unit}`).join(' · ') || '—' },
    { key: 'status', header: 'Дефицит при отказе', width: 'minmax(150px, 1fr)', render: (row) =>
      <div className="invoice-identity">{invoiceHistoryStatuses.map((status) => row.stockCounts[status]
        ? <small key={status}>{labels[status]} · {fmtQty(row.stockCounts[status]!)}</small> : null)}</div> },
    { key: 'date', header: 'Последний отказ', width: '104px', render: (row) => row.latestRefusal ? date(row.latestRefusal) : '—' },
    { key: 'details', header: 'Заказы', width: '85px', render: (row) =>
      <button className="invoice-history-link" type="button" onClick={() => setDetail(row)}>Открыть</button> },
  ];

  async function download() {
    setError('');
    try {
      const all = await loadInvoiceHistory();
      const now = new Date().toISOString();
      save(new Blob([encodeInvoiceHistory(all, now)], { type: 'application/json' }), `invoice-history-${now.slice(0, 10)}.json`);
    } catch {
      setError('Не удалось скачать историю счетов.');
    }
  }

  async function readBackup(file: File) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const incoming = decodeInvoiceHistory(await file.text());
      onRefresh(await loadInvoiceHistory());
      setRestore(incoming);
    } catch {
      setError('Не удалось прочитать резервную копию истории счетов.');
    } finally {
      setBusy(false);
    }
  }

  async function applyBackup() {
    if (!restore) return;
    setBusy(true);
    setError('');
    try {
      const result = await restoreInvoiceHistory(restore);
      onRefresh(await loadInvoiceHistory());
      setRestore(null);
      setNotice(`Восстановлено комплектов: ${result.added.length}. Повторов: ${result.duplicates}. Расхождений: ${result.conflicts.length}.`);
    } catch {
      setError('Не удалось восстановить историю. Повторите загрузку файла.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel invoice-result invoice-history" aria-labelledby="invoice-history-heading">
    <div className="section-heading">
      <h2 id="invoice-history-heading">История отказов по счетам</h2>
      <div className="invoice-actions">
        <Button className="secondary" onClick={() => void download()}>Скачать всю историю JSON</Button>
        <Button className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>Восстановить из JSON</Button>
        <input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label="Резервная копия истории"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void readBackup(file);
          }} />
      </div>
    </div>
    {notice && <Alert>{notice}</Alert>}
    {error && !restore && <Alert tone="danger">{error}</Alert>}
    <div className="invoice-actions" role="group" aria-label="Представление истории">
      <Button className={view === 'supplier' ? '' : 'secondary'} aria-pressed={view === 'supplier'} onClick={() => setView('supplier')}>Поставщики</Button>
      <Button className={view === 'sku' ? '' : 'secondary'} aria-pressed={view === 'sku'} onClick={() => setView('sku')}>Артикулы</Button>
    </div>
    <div className="invoice-filters">
      <label>Юрлицо<Select value={filters.inn ?? ''} onChange={(event) => setFilters({ ...filters, inn: event.target.value })}>
        <option value="">Все юрлица</option>
        {identities.suppliers.map(({ key, name }) => <option key={key} value={key}>{name} · {key}</option>)}
      </Select></label>
      <label>Артикул<Select value={filters.sku ?? ''} onChange={(event) => setFilters({ ...filters, sku: event.target.value })}>
        <option value="">Все артикулы</option>
        {identities.skus.map(({ key, name }) => <option key={key} value={key}>{name} · {key}</option>)}
      </Select></label>
      <label>С даты сверки<Input value={filters.from ?? ''} type="date" onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label>По дату сверки<Input value={filters.to ?? ''} type="date" onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <label>Статус дефицита<Select value={filters.status ?? ''} onChange={(event) =>
        setFilters({ ...filters, status: event.target.value as InvoiceHistoryStatus | '' })}>
        <option value="">Все статусы</option>
        {invoiceHistoryStatuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
      </Select></label>
      <label>Ранжирование<Select value={ranking} onChange={(event) => setRanking(event.target.value as Ranking)}>
        {Object.entries(rankings).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </Select></label>
      <label>Минимум заказов<Input type="number" min="0" step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
    </div>
    <VirtualTable rows={summaries} columns={columns} getRowKey={(row) => row.key} maxHeight="min(55vh, 600px)"
      emptyMessage={records.length ? 'По выбранным условиям завершённых сверок нет.' : 'Завершите первую сверку, чтобы появилась история.'} />
    {reopened.length > 0 && <details>
      <summary>Переоткрытые сверки ({reopened.length})</summary>
      <ul>{reopened.map((record) => <li key={record.id}>
        <button type="button" className="invoice-history-link" onClick={() => onOpen(record)}>
          {lastClosedInvoiceHistory(record)?.supplier.name} · {record.orderIds.length} заказов · {date(record.revisions.at(-1)!.at)}
        </button>
      </li>)}</ul>
    </details>}
    {detail && <HistoryDetails summary={detail} onClose={() => setDetail(null)} onOpen={(record) => {
      setDetail(null);
      onOpen(record);
    }} />}
    {restore && preview && <Dialog title="Восстановление истории" onClose={() => { if (!busy) setRestore(null); }} actions={<>
      <Button className="secondary" disabled={busy} onClick={() => setRestore(null)}>Закрыть</Button>
      <Button disabled={busy || !preview.added.length} onClick={() => void applyBackup()}>Добавить записи</Button>
    </>}>
      <p>Новых комплектов: {preview.added.length} · Повторов: {preview.duplicates} · Расхождений: {preview.conflicts.length}</p>
      {preview.conflicts.length > 0 && <Alert tone="warning">
        Комплекты с расхождениями будут пропущены.
        <ul>{preview.conflicts.map((supplier, index) => <li key={index}>{supplier}</li>)}</ul>
      </Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>}
  </section>;
}

function HistoryDetails({ summary, onClose, onOpen }: {
  summary: InvoiceHistorySummary; onClose: () => void; onOpen: (record: InvoiceHistoryRecord) => void;
}) {
  const columns: VirtualColumn<InvoiceHistoryDetail>[] = [
    { key: 'order', header: 'Заказ', width: 'minmax(140px, 1fr)', render: ({ order, record, revision }) =>
      <div className="invoice-identity">
        <button type="button" className="invoice-history-link" onClick={() => onOpen(record)}>{order.branch}</button>
        <small>{revision.supplier.name} · ИНН {revision.supplier.inn}</small>
        <small>{order.exportedAt ? date(order.exportedAt) : `Сверка ${date(revision.at)}`}</small>
      </div> },
    { key: 'item', header: 'Артикул', width: 'minmax(100px, .8fr)', render: ({ position }) =>
      <div className="invoice-identity"><strong>{position.article || position.skuCode}</strong><small>{position.name}</small></div> },
    { key: 'qty', header: 'Заказано / в счетах', width: '110px', className: 'num',
      render: ({ position }) => `${fmtQty(position.requested)} / ${fmtQty(position.invoiced)} ${position.unit ?? ''}` },
    { key: 'outcome', header: 'Результат', width: 'minmax(126px, .8fr)', render: ({ position }) =>
      <div className="invoice-identity">
        <strong>{outcomeLabels[position.outcome]}</strong>
        {position.refusalAt && <small>{labels[position.stockStatus]} · {date(position.refusalAt)}</small>}
        {position.reason === 'confirmed' && <small>Подтвердил поставщик</small>}
      </div> },
    { key: 'files', header: 'Счета комплекта', width: 'minmax(150px, 1fr)', render: ({ revision, record }) =>
      <div className="invoice-identity">
        {revision.documents.length ? revision.documents.map((file, index) => <small key={index}>{file.name}</small>) : <small>Без счёта</small>}
        {record.revisions.length > 1 && <small>Версий сверки: {Math.ceil(record.revisions.length / 2)}</small>}
      </div> },
  ];
  return <Dialog title={`Заказы · ${summary.name}`} size="wide" onClose={onClose}>
    <VirtualTable rows={summary.details} columns={columns}
      getRowKey={({ record, position }) => JSON.stringify([record.id, position.key])} maxHeight="min(57vh, 600px)" />
  </Dialog>;
}
