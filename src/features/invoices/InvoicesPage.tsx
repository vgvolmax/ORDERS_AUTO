import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowOrder } from '../../app/selectors';
import { BrandIcon } from '../../components/BrandIcon';
import { Dialog } from '../../components/Dialog';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import { Alert, Button, EmptyState, SearchInput, Select } from '../../components/ui';
import {
  buildInvoiceAdjustments,
  compareInvoice,
} from '../../domain/invoices';
import { fmtQty, money } from '../../format/numbers';
import {
  InvoiceSheetsRequiredError,
  parseInvoiceWorkbook,
  selectInvoiceSheets,
  type ParsedInvoiceSheet,
} from '../../import/invoiceParser';
import { InvoiceSheets } from './InvoiceSheets';
import {
  InvoiceResults,
  type InvoiceAction,
  type InvoiceResult,
} from './InvoiceResults';
import { useInvoiceOrders } from './useInvoiceOrders';
import './InvoicesPage.css';

type EligibleOrder = WorkflowOrder & { exported: boolean };
type SheetChoice = { sheets: ParsedInvoiceSheet[]; selectedNames: string[] };
type InvoiceFile = { context: string; name: string } & (
  | { status: 'reading' }
  | { status: 'failed'; error: string }
  | ({ status: 'selecting' } & SheetChoice)
  | { status: 'ready'; data: ReturnType<typeof parseInvoiceWorkbook>; sheetChoice?: SheetChoice }
);
type Comparison = InvoiceResult & { scope: string };
type Confirmation = { message: string; label: string; run: () => void };

const noOrders: readonly string[] = [];

export function InvoicesPage({
  initialOrderIds = noOrders,
  onDirtyChange,
}: {
  initialOrderIds?: readonly string[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { sources, sourceId, selectSource, orders, skuCodes, loading, error, historyError, verifySource } =
    useInvoiceOrders();
  const [selectedIds, setSelectedIds] = useState(() => [...new Set(initialOrderIds)]);
  const [orderQuery, setOrderQuery] = useState('');
  const [orderStatus, setOrderStatus] = useState('all');
  const [file, setFile] = useState<InvoiceFile | null>(null);
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
  const fileSequence = useRef(0);
  const actionSequence = useRef(0);

  const selectedOrders = useMemo(() => {
    const ids = new Set(selectedIds);
    return orders.filter((order) => ids.has(order.id));
  }, [orders, selectedIds]);
  const supplier = selectedOrders[0]?.supplier;
  const completeSelection =
    !loading &&
    !error &&
    selectedOrders.length > 0 &&
    selectedOrders.length === selectedIds.length &&
    selectedOrders.every((order) => order.supplier === supplier);
  const context = JSON.stringify([sourceId, supplier]);
  const scope = useMemo(
    () => completeSelection ? orderFingerprint(sourceId, selectedOrders, skuCodes) : null,
    [completeSelection, sourceId, selectedOrders, skuCodes],
  );
  const activeFile = file?.context === context ? file : null;
  const readyFile = activeFile?.status === 'ready' ? activeFile : null;
  const sheetChoice = activeFile?.status === 'selecting' ? activeFile : readyFile?.sheetChoice;
  const visibleComparison =
    comparison && scope !== null && comparison.scope === scope && !invalidated
      ? comparison
      : null;
  const latest = useRef({ context, scope });
  useLayoutEffect(() => {
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
  }

  function discardFile() {
    fileSequence.current++;
    setFile(null);
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

  function changeSelection(ids: string[]) {
    withConfirmation(
      'Изменение состава заказов сбросит результат сверки и ручные правки корректировки.',
      'Изменить выбор',
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

  async function readInvoice(next: File) {
    const current = ++fileSequence.current;
    resetComparison();
    const fileInfo = { context, name: next.name };
    setFile({ ...fileInfo, status: 'reading' });
    try {
      if (!/\.xlsx?$/i.test(next.name)) {
        throw new Error('Выберите счёт в формате .xlsx или .xls.');
      }
      const bytes = await next.arrayBuffer();
      if (fileSequence.current !== current || latest.current.context !== context) return;
      const data = parseInvoiceWorkbook(bytes);
      setFile({ ...fileInfo, status: 'ready', data });
    } catch (failure) {
      if (fileSequence.current !== current || latest.current.context !== context) return;
      if (failure instanceof InvoiceSheetsRequiredError) {
        setFile({ ...fileInfo, status: 'selecting', sheets: failure.sheets, selectedNames: [] });
        return;
      }
      setFile({
        ...fileInfo,
        status: 'failed',
        error: failure instanceof Error ? failure.message : 'Не удалось прочитать счёт.',
      });
    }
  }

  function changeSheets(name: string, included: boolean) {
    if (!activeFile || !sheetChoice) return;
    const selectedNames = included
      ? [...sheetChoice.selectedNames, name]
      : sheetChoice.selectedNames.filter((selected) => selected !== name);
    withConfirmation(
      'Смена листов счёта сбросит результат сверки и ручные правки корректировки.',
      'Изменить листы',
      () => {
        resetComparison();
        setFile({ context, name: activeFile.name, status: 'selecting', sheets: sheetChoice.sheets, selectedNames });
      },
    );
  }

  function applySheets() {
    if (activeFile?.status !== 'selecting' || !activeFile.selectedNames.length) return;
    const { sheets, selectedNames } = activeFile;
    setFile({
      context, name: activeFile.name, status: 'ready',
      data: selectInvoiceSheets(sheets, selectedNames),
      sheetChoice: { sheets, selectedNames },
    });
  }

  function chooseFile(next: File) {
    withConfirmation(
      'Новый счёт заменит текущий файл. Результат сверки и ручные правки корректировки будут сброшены.',
      'Заменить счёт',
      () => void readInvoice(next),
    );
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
    if (!readyFile || !scope) return;
    withConfirmation(
      'Повторная сверка пересоберёт корректировку и сбросит ручные правки.',
      'Пересобрать сверку',
      () => void runVerified(
        'Сверка…',
        () => {
          const rows = compareInvoice(selectedOrders, readyFile.data.items, skuCodes);
          const adjustments = buildInvoiceAdjustments(rows, 'invoice');
          setComparison({ scope, rows, adjustments, mode: 'invoice', drafts: new Map() });
          setExportedDraft(null);
          setInvalidated(false);
        },
        'Не удалось сверить заказы со счётом. Повторите сверку.',
      ),
    );
  }

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
      </header>

      <div className="invoice-inputs">
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
          <h2 id="invoice-file-heading">2. Счёт поставщика</h2>
          <p>Загрузите файл .xlsx или .xls. Счёт обрабатывается на этом компьютере.</p>
          <input
            ref={fileInput}
            hidden
            type="file"
            aria-label="Файл счёта поставщика"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const next = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (next && completeSelection) chooseFile(next);
            }}
          />
          <div className="invoice-actions">
            <Button
              className="secondary"
              disabled={!completeSelection}
              onClick={() => fileInput.current?.click()}
            >
              <BrandIcon name="upload" />
              {activeFile ? 'Заменить счёт' : 'Выбрать счёт'}
            </Button>
            <Button
              disabled={!completeSelection || !readyFile || Boolean(action)}
              aria-busy={action === 'Сверка…'}
              onClick={compare}
            >
              <BrandIcon name="swap" />
              {action === 'Сверка…' ? action : 'Сравнить'}
            </Button>
          </div>
          {activeFile ? (
            <div className="invoice-file-info" aria-live="polite">
              <BrandIcon name="file" />
              <span>
                <strong title={activeFile.name}>{activeFile.name}</strong>
                <small>
                  {activeFile.status === 'reading' ? 'Чтение счёта…' :
                    activeFile.status === 'ready' ? `Позиций в файле: ${fmtQty(activeFile.data.items.length)}` :
                    activeFile.status === 'selecting' ? 'Выберите листы для сверки' :
                    'Файл не загружен'}
                </small>
              </span>
            </div>
          ) : <p className="invoice-upload-hint">{completeSelection ? 'Счёт пока не выбран.' : 'Сначала отметьте заказы одного поставщика.'}</p>}
          {sheetChoice && (
            <InvoiceSheets
              {...sheetChoice}
              applied={activeFile?.status === 'ready'}
              disabled={Boolean(action)}
              onChange={changeSheets}
              onApply={applySheets}
            />
          )}
          {activeFile?.status === 'failed' && <Alert tone="danger">{activeFile.error}</Alert>}
          {readyFile && readyFile.data.warnings.length > 0 && (
            <Alert tone="warning">
              <details>
                <summary>Замечания к счёту ({readyFile.data.warnings.length})</summary>
                <ul>{readyFile.data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </details>
            </Alert>
          )}
        </section>
      </div>

      {comparison && !visibleComparison && (
        <Alert tone="warning">
          Заказы изменились или сеанс недоступен. Повторите сверку, чтобы открыть результат и экспорт.
        </Alert>
      )}
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {visibleComparison && (
        <InvoiceResults
          key={visibleComparison.scope}
          comparison={visibleComparison}
          supplier={supplier!}
          fileName={readyFile?.name ?? ''}
          action={action}
          runVerified={runVerified}
          onChange={(changes) => {
            cancelAction();
            setComparison({ ...visibleComparison, ...changes });
          }}
          onExported={() => setExportedDraft(visibleComparison)}
          confirmReplace={withConfirmation}
        />
      )}
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
      order.lines.filter((line) => line.orderQty > 0).map((line) => [
        line.skuCode, line.article, line.name, line.orderQty, line.unit, line.unitPrice, line.amount,
      ]),
    ]),
  ]);
}
