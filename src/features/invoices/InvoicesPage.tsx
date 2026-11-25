import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InvoiceOrder, InvoiceOrderBasis } from '../../app/invoiceOrders';
import { BrandIcon } from '../../components/BrandIcon';
import { Dialog } from '../../components/Dialog';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import { Alert, Button, EmptyState, SearchInput, Select } from '../../components/ui';
import {
  buildInvoiceAdjustments,
  compareInvoice,
  type InvoiceItem,
} from '../../domain/invoices';
import { stockStatusSeverity } from '../../domain/demand';
import {
  buildHistoryOrders, historyOrderKey, lastClosedInvoiceHistory, prepareHistoryPositions,
  type ClosedInvoiceHistory, type HistoryDecision, type InvoiceHistoryRecord,
} from '../../domain/invoiceHistory';
import { normalizeKey } from '../../domain/normalize';
import type { StockStatus } from '../../domain/types';
import { appendInvoiceHistory, loadInvoiceHistory } from '../../persistence/invoiceHistory';
import { moneyProduct, moneySum } from '../../domain/money';
import { fmtQty, money } from '../../format/numbers';
import {
  InvoiceSheetsRequiredError,
  parseInvoiceWorkbook,
  selectInvoiceSheets,
  type ParsedInvoiceSheet,
} from '../../import/invoiceParser';
import { CloseInvoiceHistoryDialog } from './CloseInvoiceHistoryDialog';
import { InvoiceHistoryPanel } from './InvoiceHistoryPanel';
import { archiveInvoiceFile, openArchivedInvoiceFile, type ArchivedInvoiceFile } from './invoiceHistoryFiles';
import { InvoiceSheets } from './InvoiceSheets';
import {
  InvoiceResults,
  type InvoiceAction,
  type InvoiceResult,
} from './InvoiceResults';
import { useInvoiceOrders } from './useInvoiceOrders';
import './InvoicesPage.css';

type EligibleOrder = InvoiceOrder;
type SheetChoice = { sheets: ParsedInvoiceSheet[]; selectedNames: string[] };
type InvoiceFile = { id: string; name: string } & (
  | { status: 'failed'; error: string }
  | ({ status: 'selecting'; bytes: Uint8Array<ArrayBuffer> } & SheetChoice)
  | ArchivedInvoiceFile
);
type Comparison = InvoiceResult & { scope: string; fileVersion: string };

async function readInvoiceFile(file: File, id: string, isCurrent: () => boolean): Promise<InvoiceFile | null> {
  const info = { id, name: file.name };
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (!/\.xlsx?$/i.test(file.name)) throw new Error('Выберите счёт в формате .xlsx или .xls.');
    const buffer = await file.arrayBuffer();
    if (!isCurrent()) return null;
    bytes = new Uint8Array(buffer);
    return { ...info, status: 'ready', bytes, data: parseInvoiceWorkbook(buffer) };
  } catch (failure) {
    if (bytes && failure instanceof InvoiceSheetsRequiredError)
      return { ...info, status: 'selecting', bytes, sheets: failure.sheets, selectedNames: [] };
    return { ...info, status: 'failed', error: failure instanceof Error ? failure.message : 'Не удалось прочитать счёт.' };
  }
}
type Confirmation = { message: string; label: string; run: () => void };

const noOrders: readonly string[] = [];
const noHistory: InvoiceHistoryRecord[] = [];
const noDemand: readonly { skuCode: string; branch: string; purchaseStatus: StockStatus }[] = [];
const stockKey = (branch: string, skuCode: string) => JSON.stringify([normalizeKey(branch), skuCode]);

export function InvoicesPage({
  initialOrderIds = noOrders,
  initialSourceId,
  onDirtyChange,
}: {
  initialOrderIds?: readonly string[];
  initialSourceId?: string | undefined;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [basis, setBasis] = useState<InvoiceOrderBasis>('preferred');
  const { sources, sourceId, selectSource, orders, skuCodes, currentDemand = noDemand, loading, error, historyError, verifySource } =
    useInvoiceOrders(initialSourceId, basis);
  const currentSource = sourceId === sources[0]?.id;
  const [view, setView] = useState<'compare' | 'history'>('compare');
  const [records, setRecords] = useState(noHistory);
  const [recordsError, setRecordsError] = useState('');
  const [closing, setClosing] = useState<ReturnType<typeof prepareHistoryPositions> | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyNotice, setHistoryNotice] = useState('');
  const [resume, setResume] = useState<InvoiceHistoryRecord | null>(null);
  const [inputsOpen, setInputsOpen] = useState(true);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const focusResult = useRef(false);
  const [selectedIds, setSelectedIds] = useState(() => [...new Set(initialOrderIds)]);
  const [orderQuery, setOrderQuery] = useState('');
  const [orderStatus, setOrderStatus] = useState('all');
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [reading, setReading] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [exportedDraft, setExportedDraft] = useState<Comparison | null>(null);
  const [invalidated, setInvalidated] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [action, setAction] = useState('');
  const [actionError, setActionError] = useState('');
  const hasEdits = Boolean(
    comparison && comparison !== exportedDraft &&
    (comparison.drafts.size || comparison.mode === 'order'),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const replacement = useRef<string | null>(null);
  const fileSequence = useRef(0);
  const actionSequence = useRef(0);

  const selectedOrders = useMemo(() => {
    const ids = new Set(selectedIds);
    return orders.filter((order) => ids.has(order.id));
  }, [orders, selectedIds]);
  const supplier = selectedOrders[0]?.supplier;
  const latestSupplier = useRef(supplier);
  if (supplier) latestSupplier.current = supplier;
  const completeSelection =
    !loading &&
    !error &&
    selectedOrders.length > 0 &&
    selectedOrders.length === selectedIds.length &&
    selectedOrders.every((order) => order.supplier === supplier);
  const context = JSON.stringify([sourceId, supplier ?? (selectedIds.length ? latestSupplier.current : null)]);
  const scope = useMemo(
    () => completeSelection ? orderFingerprint(sourceId, selectedOrders, skuCodes) : null,
    [completeSelection, sourceId, selectedOrders, skuCodes],
  );
  const historyId = historyOrderKey(sourceId, selectedIds);
  const activeRecord = records.find(({ id }) => id === historyId);
  const saved = lastClosedInvoiceHistory(activeRecord);
  const closed = activeRecord?.revisions.at(-1)?.kind === 'closed';
  const stockStatus = useMemo(() => new Map(currentDemand.map((line) => [
    stockKey(line.branch, line.skuCode), line.purchaseStatus,
  ])), [currentDemand]);
  const currentDeficits = useMemo(() => {
    const result = new Map<string, StockStatus>();
    const include = (sku: string, status: StockStatus) => {
      const before = result.get(sku);
      if (!before || stockStatusSeverity[status] > stockStatusSeverity[before]) result.set(sku, status);
    };
    const ordered = new Set<string>();
    for (const order of selectedOrders) {
      for (const { skuCode, orderQty } of order.lines) {
        if (orderQty <= 0) continue;
        ordered.add(skuCode);
        const status = stockStatus.get(stockKey(order.branch, skuCode));
        if (status) include(skuCode, status);
      }
    }
    for (const line of currentDemand) {
      if (!ordered.has(line.skuCode)) include(line.skuCode, line.purchaseStatus);
    }
    return result;
  }, [currentDemand, selectedOrders, stockStatus]);
  const readyFiles = files.filter((file) => file.status === 'ready');
  const failedFiles = files.filter((file) => file.status === 'failed').length;
  const pendingFiles = files.length - readyFiles.length - failedFiles;
  const skippedRows = readyFiles.reduce((total, file) => total + (file.data.skippedRows ?? 0), 0);
  const fileVersion = JSON.stringify(readyFiles.map((file) => [file.id, file.sheetChoice?.selectedNames]));
  const canCompare = !reading && pendingFiles === 0 && readyFiles.length > 0;
  const incomplete = reading || failedFiles > 0 || pendingFiles > 0 || skippedRows > 0;
  const visibleComparison =
    comparison && scope !== null && comparison.scope === scope && comparison.fileVersion === fileVersion && !invalidated
      ? comparison
      : null;
  useEffect(() => {
    let alive = true;
    void loadInvoiceHistory().then((history) => { if (alive) setRecords(history); })
      .catch(() => { if (alive) setRecordsError('Не удалось прочитать историю счетов.'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!resume || sourceId !== resume.sourceId || loading) return;
    setResume(null);
    if (!completeSelection) {
      setActionError('Исходный состав заказа недоступен. Сохранённые счета и итоги можно скачать из истории.');
      return;
    }
    try {
      const current = ++fileSequence.current;
      setFiles((lastClosedInvoiceHistory(resume)?.documents ?? []).map((file, index) =>
        openArchivedInvoiceFile(file, `${current}:${index}`)));
    } catch {
      setActionError('Не удалось открыть сохранённые счета. Загрузите полный комплект заново.');
    }
  }, [resume, sourceId, loading, completeSelection]);

  useLayoutEffect(() => {
    if (!visibleComparison || !focusResult.current) return;
    focusResult.current = false;
    resultHeading.current?.focus({ preventScroll: true });
    resultHeading.current?.scrollIntoView?.({ block: 'start' });
  }, [visibleComparison]);
  const latest = useRef({ context, scope });
  useLayoutEffect(() => {
    if (latest.current.context !== context) discardFile();
    latest.current = { context, scope };
  }, [context, scope]);
  useLayoutEffect(() => {
    if (comparison && comparison.scope !== scope) setInvalidated(true);
  }, [comparison, scope]);
  useEffect(() => () => {
    fileSequence.current++;
    actionSequence.current++;
  }, []);
  useLayoutEffect(() => {
    onDirtyChange?.(hasEdits);
    return () => onDirtyChange?.(false);
  }, [hasEdits, onDirtyChange]);
  useEffect(() => {
    if (!hasEdits) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasEdits]);

  const normalizedOrderQuery = orderQuery.trim().toLocaleLowerCase('ru-RU');
  const visibleOrders = orders.filter((order) => {
    const matchesQuery = [order.supplier, order.branch].some((value) =>
      value.toLocaleLowerCase('ru-RU').includes(normalizedOrderQuery),
    );
    return matchesQuery &&
      (orderStatus === 'all' || (orderStatus === 'exported' ? order.exported : order.reviewed));
  });
  const selectedSet = new Set(selectedIds);
  const hiddenSelection = selectedOrders.length -
    visibleOrders.filter((order) => selectedSet.has(order.id)).length;
  const selectionUnavailable = !loading && selectedIds.length > 0 && !completeSelection;

  function cancelAction() {
    actionSequence.current++;
    setAction('');
    setActionError('');
  }

  function resetComparison() {
    cancelAction();
    setComparison(null);
    setExportedDraft(null);
    setInvalidated(false);
    setInputsOpen(true);
  }

  function discardFile() {
    fileSequence.current++;
    setFiles([]);
    setReading(false);
    setDuplicateCount(0);
  }

  function withConfirmation(message: string, label: string, run: () => void) {
    if (hasEdits) setConfirmation({ message, label, run });
    else run();
  }

  function changeSource(nextSourceId: string) {
    if (nextSourceId === sourceId) return;
    withConfirmation(
      'При смене сеанса выбранные заказы, счёт и ручные правки корректировки будут сброшены.',
      'Сменить сеанс',
      () => {
        resetComparison();
        discardFile();
        setSelectedIds([]);
        setOrderQuery('');
        setOrderStatus('all');
        selectSource(nextSourceId);
      },
    );
  }

  function changeSelection(ids: string[], clear = false) {
    withConfirmation(
      clear ? 'Выбранные заказы, счета и ручные правки будут удалены из черновика.'
        : 'Изменение состава заказов сбросит результат сверки и ручные правки корректировки.',
      clear ? 'Очистить сверку' : 'Изменить выбор',
      () => {
        resetComparison();
        if (ids.length === 0) discardFile();
        setSelectedIds(ids);
      },
    );
  }

  function toggleOrder(order: EligibleOrder) {
    if (supplier && order.supplier !== supplier) return;
    changeSelection(
      selectedSet.has(order.id)
        ? selectedIds.filter((id) => id !== order.id)
        : [...selectedIds, order.id],
    );
  }

  async function addInvoices(incoming: File[], replaceId: string | null) {
    if (reading || !incoming.length) return;
    const current = ++fileSequence.current;
    const isCurrent = () => fileSequence.current === current && latest.current.context === context;
    cancelAction();
    setReading(true);
    const parsed = await Promise.all(incoming.map((file, index) => readInvoiceFile(file, `${current}:${index}`, isCurrent)));
    if (!isCurrent()) return;
    const next = files.filter(({ id }) => id !== replaceId);
    let duplicates = 0;
    for (const file of parsed) {
      if (!file) continue;
      if (file.status !== 'failed' && next.some((existing) =>
        existing.status !== 'failed' && existing.bytes.length === file.bytes.length &&
        existing.bytes.every((byte, index) => byte === file.bytes[index]))) {
        duplicates++;
      } else next.push(file);
    }
    setFiles(next);
    setDuplicateCount(duplicates);
    setReading(false);
  }

  function changeSheets(file: InvoiceFile, choice: SheetChoice, name: string, included: boolean) {
    if (file.status === 'failed') return;
    const selectedNames = included
      ? [...choice.selectedNames, name]
      : choice.selectedNames.filter((selected) => selected !== name);
    withConfirmation('Смена листов счёта сбросит результат сверки и ручные правки корректировки.',
      'Изменить листы', () => {
        resetComparison();
        setFiles((current) => current.map((item) => item.id === file.id
          ? { id: file.id, name: file.name, bytes: file.bytes, status: 'selecting', sheets: choice.sheets, selectedNames }
          : item));
      });
  }

  function applySheets(file: Extract<InvoiceFile, { status: 'selecting' }>) {
    const { sheets, selectedNames } = file;
    const data = selectInvoiceSheets(sheets, selectedNames);
    setFiles((current) => current.map((item) => item.id === file.id
      ? { id: file.id, name: file.name, bytes: file.bytes, status: 'ready', data, sheetChoice: { sheets, selectedNames } }
      : item));
  }

  function removeInvoice(file: InvoiceFile) {
    const remove = () => {
      cancelAction();
      setFiles((current) => current.filter((item) => item.id !== file.id));
    };
    if (file.status === 'ready') withConfirmation(
      'Пересчёт после удаления счёта сбросит ручные правки.', 'Удалить счёт', () => {
        resetComparison();
        remove();
      });
    else remove();
  }

  const runVerified: InvoiceAction = async (label, run, failureMessage) => {
    if (!scope || action) return false;
    const current = ++actionSequence.current;
    const isCurrent = () => actionSequence.current === current && latest.current.scope === scope;
    setAction(label);
    setActionError('');
    try {
      try {
        await verifySource();
      } catch (failure) {
        if (isCurrent()) {
          setInvalidated(true);
          setActionError(
            failure instanceof Error ? failure.message : 'Не удалось проверить актуальность рабочего сеанса.',
          );
        }
        return false;
      }
      if (!isCurrent()) return false;
      await run(isCurrent);
      return isCurrent();
    } catch {
      if (isCurrent()) setActionError(failureMessage);
      return false;
    } finally {
      if (actionSequence.current === current) setAction('');
    }
  };

  function compare() {
    if (!canCompare || !scope) return;
    withConfirmation(
      'Повторная сверка пересоберёт корректировку и сбросит ручные правки.',
      'Пересобрать сверку',
      () => void runVerified(
        'Сверка…',
        () => {
          const items = readyFiles.flatMap((file) => file.data.items.map((item) => ({
            ...item, sourceFile: file.name, sourceFileId: file.id,
          })));
          const rows = compareInvoice(selectedOrders, items, skuCodes);
          const adjustments = buildInvoiceAdjustments(rows, 'invoice');
          setInputsOpen(false);
          focusResult.current = true;
          setComparison({ scope, fileVersion, rows, adjustments, mode: 'invoice', drafts: new Map() });
          setExportedDraft(null);
          setInvalidated(false);
        },
        'Не удалось сверить заказы со счётом. Повторите сверку.',
      ),
    );
  }

  async function refreshHistory() {
    try {
      setRecords(await loadInvoiceHistory());
      setRecordsError('');
    } catch {
      setRecordsError('Не удалось прочитать историю счетов.');
    }
  }

  function openHistoryRecord(record: InvoiceHistoryRecord) {
    if (!sources.some(({ id }) => id === record.sourceId)) {
      setRecordsError('Исходный сеанс недоступен. Счета и итоги входят в JSON-копию истории.');
      return;
    }
    withConfirmation('Открытие сохранённой сверки сбросит текущий черновик.', 'Открыть сохранённую сверку', () => {
      resetComparison();
      discardFile();
      setView('compare');
      setBasis(record.basis);
      selectSource(record.sourceId);
      setSelectedIds(record.orderIds);
      setResume(record);
    });
  }

  function openCloseHistory(rows: ReturnType<typeof compareInvoice>) {
    const overlap = records.some((record) => record.id !== historyId && record.sourceId === sourceId
      && record.orderIds.some((id) => selectedSet.has(id)));
    if (overlap) {
      setActionError('Часть заказов входит в другой комплект сверки. Откройте его из истории.');
      return;
    }
    setActionError('');
    setClosing(prepareHistoryPositions(selectedOrders, rows, (branch, skuCode) =>
      stockStatus.get(stockKey(branch, skuCode)) ?? 'unknown'));
  }

  async function saveHistory(party: ClosedInvoiceHistory['supplier'], decisions: ReadonlyMap<string, HistoryDecision>) {
    if (!closing || closed || historyBusy) return;
    setHistoryBusy(true);
    try {
      await verifySource();
      const at = new Date().toISOString();
      const event: ClosedInvoiceHistory = {
        kind: 'closed', at, supplier: party,
        documents: readyFiles.map(archiveInvoiceFile),
        orders: buildHistoryOrders(selectedOrders, closing, decisions, at, saved?.orders),
      };
      const record: InvoiceHistoryRecord = {
        id: historyId, sourceId, basis, orderIds: [...selectedIds].sort(),
        revisions: [...(activeRecord?.revisions ?? []), event],
      };
      setRecords(await appendInvoiceHistory(record, activeRecord?.revisions.length ?? 0));
      setClosing(null);
      setHistoryNotice('Итог сверки сохранён в истории.');
    } catch (failure) {
      void refreshHistory();
      throw failure;
    } finally {
      setHistoryBusy(false);
    }
  }

  async function reopenHistory() {
    if (!activeRecord || !closed || historyBusy) return;
    setHistoryBusy(true);
    setActionError('');
    try {
      const at = new Date().toISOString();
      const record: InvoiceHistoryRecord = {
        ...activeRecord, revisions: [...activeRecord.revisions, { kind: 'reopened', at }],
      };
      setRecords(await appendInvoiceHistory(record, activeRecord.revisions.length));
      setHistoryNotice('Сверка переоткрыта. Проверьте весь комплект и сохраните новый итог.');
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'Не удалось переоткрыть сверку.');
      void refreshHistory();
    } finally {
      setHistoryBusy(false);
    }
  }

  const matchingParties = new Map(records.flatMap((record) => {
    const previous = lastClosedInvoiceHistory(record);
    return previous && previous.orders.some(({ id }) => orders.some((order) => order.id === id && order.supplier === supplier))
      ? [[previous.supplier.inn, previous.supplier] as const] : [];
  }));
  const initialParty = saved?.supplier ?? (matchingParties.size === 1 ? [...matchingParties.values()][0] : undefined);
  const orderColumns: VirtualColumn<EligibleOrder>[] = [
    {
      key: 'selected', header: 'Выбор', width: '59px',
      render: (order) => (
        <input
          type="checkbox"
          aria-label={`Выбрать заказ ${order.supplier} — ${order.branch}`}
          checked={selectedSet.has(order.id)}
          disabled={Boolean(supplier && supplier !== order.supplier)}
          onChange={() => toggleOrder(order)}
        />
      ),
    },
    {
      key: 'supplier', header: 'Поставщик / подразделение', width: 'minmax(210px, 1fr)',
      render: (order) => (
        <div className="invoice-identity">
          <strong>{order.supplier}</strong>
          <small>{order.branch}</small>
          <small>{order.archivedBasis === 'export' ? 'Состав из выгрузки' : order.archivedBasis === 'session' ? 'По данным архивного сеанса' : 'Текущая версия'}</small>
          {order.exportedAt && <small>{new Date(order.exportedAt).toLocaleString('ru-RU')}</small>}
        </div>
      ),
    },
    {
      key: 'status', header: 'Статус', width: '105px',
      render: (order) => (
        <div className="invoice-differences">
          {order.reviewed && <span className="badge NO_NORM">Проверен</span>}
          {order.exported && <span className="badge OK">Выгружен</span>}
        </div>
      ),
    },
    {
      key: 'amount', header: 'Сумма заказа', width: '113px', className: 'num',
      render: (order) => order.totalAmount === null ? '—' : money(order.totalAmount),
    },
  ];

  return (
    <main className="invoices-page">
      <header>
        <h1>Сверка счетов</h1>
        <p>Сверьте заказы одного поставщика со счётом и подготовьте корректировку для 1С.</p>
        <div className="invoice-actions invoice-history-tabs" role="group" aria-label="Раздел счетов">
          <Button className={view === 'compare' ? '' : 'secondary'} aria-pressed={view === 'compare'}
            onClick={() => setView('compare')}>Сверка</Button>
          <Button className={view === 'history' ? '' : 'secondary'} aria-pressed={view === 'history'}
            onClick={() => { setView('history'); void refreshHistory(); }}>История отказов</Button>
        </div>
      </header>
      {view === 'history' && <>
        {recordsError && <Alert tone="warning">{recordsError}</Alert>}
        <InvoiceHistoryPanel records={records} onRefresh={setRecords} onOpen={openHistoryRecord} />
      </>}
      <div className="invoice-workflow" hidden={view === 'history'}>
      {historyNotice && <Alert>{historyNotice}</Alert>}

      {visibleComparison && <div className="invoice-actions invoice-source-summary">
        <div>
          <strong>{supplier} · Заказов: {fmtQty(selectedOrders.length)} · Файлов: {fmtQty(readyFiles.length)}</strong>
          <small>{sources.find((source) => source.id === sourceId)?.label} · {[
            ...new Set(selectedOrders.map((order) => order.archivedBasis === 'export'
              ? 'Состав из выгрузки'
              : order.archivedBasis === 'session' ? 'Состав архивного сеанса' : 'Текущий состав')),
          ].join(' / ')}</small>
        </div>
        <Button className="secondary" aria-expanded={inputsOpen} onClick={() => setInputsOpen(!inputsOpen)}>
          {inputsOpen ? 'Свернуть источники' : 'Показать источники'}
        </Button>
        <Button className="secondary" onClick={() => changeSelection([], true)}>Очистить сверку</Button>
      </div>}
      <div className="invoice-inputs" data-collapsed={Boolean(visibleComparison && !inputsOpen)}>
        <section className="panel invoice-source" aria-labelledby="invoice-orders-heading">
          <h2 id="invoice-orders-heading">1. Заказы для сверки</h2>
          <div className="invoice-filters">
            <label className="invoice-session">
              Рабочий сеанс
              <Select value={sourceId} onChange={(event) => changeSource(event.target.value)}>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </Select>
            </label>
            {currentSource && <label>
              Версия заказов
              <Select value={basis} onChange={(event) => {
                const next = event.target.value as InvoiceOrderBasis;
                withConfirmation('Смена версии заказа сбросит результат и ручные правки.', 'Сменить версию', () => {
                  resetComparison();
                  setBasis(next);
                });
              }}>
                <option value="preferred">Последняя выгрузка, если есть</option>
                <option value="current">Текущая проверенная или выгруженная</option>
              </Select>
            </label>}
            <label className="filter-search">
              Поиск заказов
              <SearchInput
                type="search"
                aria-label="Поиск заказов"
                placeholder="Поставщик или подразделение"
                value={orderQuery}
                onValueChange={setOrderQuery}
              />
            </label>
            <label>
              Статус заказов
              <Select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>
                <option value="all">Все</option>
                <option value="reviewed">Проверенные</option>
                <option value="exported">Выгруженные</option>
              </Select>
            </label>
          </div>
          <div className="invoice-selection">
            <small aria-live="polite">
              {supplier ? <><strong>{supplier}</strong> · </> : null}
              Выбрано заказов: {fmtQty(selectedOrders.length)}
              {hiddenSelection > 0 && ` · Скрыто фильтром: ${fmtQty(hiddenSelection)}`}
            </small>
            {supplier && <Button className="secondary" onClick={() => changeSelection(
              orders.filter((order) => order.supplier === supplier).map(({ id }) => id),
            )}>Все заказы поставщика</Button>}
            <Button
              className="secondary"
              disabled={selectedIds.length === 0}
              onClick={() => changeSelection([])}
            >
              Снять выбор
            </Button>
          </div>
          {error ? (
            <Alert tone={orders.length ? 'warning' : 'danger'}>{error}</Alert>
          ) : null}
          {historyError && <Alert tone="warning">{historyError}</Alert>}
          {loading ? (
            <Alert>Загрузка заказов…</Alert>
          ) : orders.length > 0 ? (
            <VirtualTable
              rows={visibleOrders}
              columns={orderColumns}
              getRowKey={(order) => order.id}
              maxHeight="min(32vh, 300px)"
              emptyMessage="По заданным фильтрам нет заказов."
            />
          ) : !error ? (
            <EmptyState>В сеансе нет проверенных или выгруженных заказов с позициями для сверки.</EmptyState>
          ) : null}
          {selectionUnavailable && (
            <Alert tone="warning">Часть выбранных заказов недоступна. Снимите выбор и отметьте нужные заказы одного поставщика.</Alert>
          )}
        </section>

        <section className="panel invoice-upload" aria-labelledby="invoice-file-heading">
          <h2 id="invoice-file-heading">2. Счета поставщика</h2>
          <input
            ref={fileInput}
            hidden
            multiple
            type="file"
            aria-label="Файл счёта поставщика"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const next = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              const replaceId = replacement.current;
              replacement.current = null;
              if (completeSelection) void addInvoices(next, replaceId);
            }}
          />
          <div className="invoice-actions">
            <Button className="secondary" disabled={!completeSelection || reading || Boolean(action)}
              onClick={() => {
                replacement.current = null;
                fileInput.current?.click();
              }}>
              <BrandIcon name="upload" /> Добавить счета
            </Button>
            <Button disabled={!completeSelection || !canCompare || Boolean(action)}
              aria-busy={action === 'Сверка…'} onClick={compare}>
              <BrandIcon name="swap" /> {action === 'Сверка…' ? action : 'Сравнить'}
            </Button>
          </div>
          {completeSelection && !files.length && !reading && !closed && <Button className="secondary"
            disabled={Boolean(action) || historyBusy}
            onClick={() => openCloseHistory(compareInvoice(selectedOrders, [], skuCodes))}>Зафиксировать отказ без счёта</Button>}
          {reading && <Alert>Читаем счета…</Alert>}
          {duplicateCount > 0 && <Alert>Пропущено повторных файлов: {fmtQty(duplicateCount)}.</Alert>}
          {!files.length && !reading && (
            <p className="invoice-upload-hint">{completeSelection ? 'Выберите один или несколько файлов .xlsx или .xls.' : 'Сначала отметьте заказы одного поставщика.'}</p>
          )}
          {files.map((file) => {
            const choice = file.status === 'selecting' ? file : file.status === 'ready' ? file.sheetChoice : undefined;
            return (
              <div className="invoice-file-entry" key={file.id}>
                <div className="invoice-file-info">
                  <BrandIcon name="file" />
                  <span>
                    <strong>{file.name}</strong>
                    <small>{file.status === 'ready'
                      ? `${fmtQty(file.data.items.length)} поз. · ${invoiceFileAmount(file.data.items)}`
                      : file.status === 'selecting' ? 'Выберите листы' : 'Файл не прочитан'}</small>
                  </span>
                  <Button className="secondary" disabled={reading || Boolean(action)} onClick={() => removeInvoice(file)}
                    aria-label={`Удалить счёт ${file.name}`}>Удалить</Button>
                </div>
                {file.status === 'failed' && <Alert tone="danger">
                  {file.error}{' '}
                  <Button className="secondary" disabled={reading || Boolean(action) || !completeSelection}
                    onClick={() => {
                      replacement.current = file.id;
                      fileInput.current?.click();
                    }}>Заменить {file.name}</Button>
                </Alert>}
                {choice && <InvoiceSheets {...choice} applied={file.status === 'ready'} disabled={reading || Boolean(action)}
                  onChange={(name, included) => changeSheets(file, choice, name, included)}
                  onApply={() => { if (file.status === 'selecting') applySheets(file); }} />}
                {file.status === 'ready' && file.data.warnings.length > 0 && (
                  <details className="invoice-file-warnings">
                    <summary>Замечания к счёту ({file.data.warnings.length})</summary>
                    <ul>{file.data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                  </details>
                )}
              </div>
            );
          })}
          {incomplete && !reading && <Alert tone="warning">
            Неполный комплект. Файлов с ошибкой: {fmtQty(failedFiles)}. Без выбранных листов: {fmtQty(pendingFiles)}.
            Пропущено товарных строк: {fmtQty(skippedRows)}. Для выгрузки в 1С примените выбор листов, исправьте или удалите проблемные файлы.
          </Alert>}
        </section>
      </div>

      {comparison && !visibleComparison && (
        <Alert tone="warning">
          {comparison.scope !== scope || invalidated ? 'Заказы изменились или сеанс недоступен.' : 'Состав счетов изменился.'}
          {' '}Повторите сверку, чтобы открыть актуальный результат и экспорт.
        </Alert>
      )}
      {closed && <Alert>
        Итог выбранных заказов уже в истории.{' '}
        <Button className="secondary" disabled={historyBusy || Boolean(action)}
          onClick={() => void reopenHistory()}>Переоткрыть сверку</Button>
      </Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {visibleComparison && (
        <InvoiceResults
          key={visibleComparison.scope}
          comparison={visibleComparison}
          headingRef={resultHeading}
          documentTotals={readyFiles.map((file) => ({
            id: file.id, name: file.name, payable: file.data.payable,
            lineTotal: invoiceLineTotal(file.data.items),
          }))}
          supplier={supplier!}
          fileName={readyFiles.length === 1 ? readyFiles[0]!.name : `Счетов: ${fmtQty(readyFiles.length)}`}
          incomplete={incomplete}
          action={action}
          runVerified={runVerified}
          onChange={(changes) => {
            cancelAction();
            setComparison({ ...visibleComparison, ...changes });
          }}
          onExported={() => setExportedDraft(visibleComparison)}
          confirmReplace={withConfirmation}
          currentDeficits={currentDeficits}
          historyAction={!closed && <Button disabled={incomplete || historyBusy || Boolean(action)}
            onClick={() => openCloseHistory(visibleComparison.rows)}>Завершить сверку</Button>}
        />
      )}
      </div>
      {closing && <CloseInvoiceHistoryDialog groups={closing} previous={saved?.orders ?? []}
        initialName={initialParty?.name ?? supplier ?? ''}
        initialInn={initialParty?.inn ?? ''}
        noDocuments={!readyFiles.length} busy={historyBusy} onClose={() => setClosing(null)} onSave={saveHistory} />}
      {confirmation && (
        <Dialog
          title="Сбросить ручные правки?"
          onClose={() => setConfirmation(null)}
          actions={
            <>
              <Button className="secondary" onClick={() => setConfirmation(null)}>Отмена</Button>
              <Button onClick={() => {
                const { run } = confirmation;
                setConfirmation(null);
                run();
              }}>{confirmation.label}</Button>
            </>
          }
        >
          <p>{confirmation.message}</p>
        </Dialog>
      )}
    </main>
  );
}

function orderFingerprint(sourceId: string, orders: readonly EligibleOrder[], skuCodes: readonly string[]): string {
  return JSON.stringify([
    sourceId,
    skuCodes,
    orders.map((order) => [
      order.id,
      order.supplier,
      order.branch,
      order.reviewed,
      order.exported,
      order.archivedBasis,
      order.lines.filter((line) => line.orderQty > 0).map((line) => [
        line.skuCode, line.article, line.name, line.orderQty, line.unit, line.unitPrice, line.amount,
      ]),
    ]),
  ]);
}

function invoiceLineTotal(items: InvoiceItem[]): number | null {
  const amounts = items.map((item) => item.amount ?? (item.price === null ? null : moneyProduct(item.quantity, item.price)));
  return amounts.some((amount) => amount === null) ? null : moneySum(amounts as number[]);
}

function invoiceFileAmount(items: InvoiceItem[]): string {
  const total = invoiceLineTotal(items);
  return total === null ? 'Сумма неизвестна' : money(total);
}
