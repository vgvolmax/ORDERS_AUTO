import { useMemo, useState } from 'react';
import { BrandIcon } from '../../components/BrandIcon';
import { Dialog } from '../../components/Dialog';
import { Alert, Button, Input, MetricCard, SearchInput, Select } from '../../components/ui';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import {
  adjustmentAmount,
  buildInvoiceAdjustments,
  invoiceDifferenceLabels,
  type InvoiceAdjustment,
  type InvoiceComparisonRow,
  type InvoiceDifference,
} from '../../domain/invoices';
import { moneyProduct, moneySum } from '../../domain/money';
import { hasInvoiceAmountDifference, hasInvoiceDiscrepancy, invoicePriceWithinTolerance, summarizeInvoiceAmounts } from '../../domain/invoiceAmounts';
import { parseOptionalNumber } from '../../domain/normalize';
import { save } from '../../export/download';
import { safeFilename } from '../../export/filenames';
import {
  conflictingInvoiceAdjustments,
  invoiceAdjustmentCsv,
  invoiceAdjustmentTsv,
  invoiceAdjustmentWorkbook,
  invoiceComparisonCsv,
} from '../../export/invoiceExport';
import { fmtQty, money } from '../../format/numbers';

type AdjustmentMode = 'invoice' | 'order';
type AdjustmentDraft = { qty?: string; price?: string; included?: boolean };
export type InvoiceResult = {
  rows: InvoiceComparisonRow[];
  mode: AdjustmentMode;
  adjustments: InvoiceAdjustment[];
  drafts: ReadonlyMap<string, AdjustmentDraft>;
};
export type InvoiceAction = (
  busyLabel: string,
  run: (isCurrent: () => boolean) => void | Promise<void>,
  failureMessage: string,
) => Promise<boolean>;

const csvType = 'text/csv;charset=utf-8';

export function InvoiceResults({
  comparison,
  supplier,
  fileName,
  incomplete,
  action,
  runVerified,
  onChange,
  onExported,
  confirmReplace,
}: {
  comparison: InvoiceResult;
  supplier: string;
  fileName: string;
  incomplete: boolean;
  action: string;
  runVerified: InvoiceAction;
  onChange: (change: Partial<InvoiceResult>) => void;
  onExported: () => void;
  confirmReplace: (message: string, label: string, run: () => void) => void;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [editQuery, setEditQuery] = useState('');
  const [includedFilter, setIncludedFilter] = useState('all');
  const [presence, setPresence] = useState('all');
  const [adjustmentPresence, setAdjustmentPresence] = useState('all');
  const [copyNotice, setCopyNotice] = useState('');
  const [copyFallback, setCopyFallback] = useState('');
  const { mode, adjustments, drafts } = comparison;
  const rows = useMemo(() => incomplete ? comparison.rows.map((row): InvoiceComparisonRow =>
    row.differences.includes('missing') ? {
      ...row,
      differences: row.differences.map((difference) => difference === 'missing' ? 'unconfirmed' : difference),
      notes: ['Позиция не найдена в прочитанных строках. Комплект счетов неполный.'],
    } : row) : comparison.rows, [comparison.rows, incomplete]);
  const amounts = useMemo(() => summarizeInvoiceAmounts(rows), [rows]);
  const counts = useMemo(() => {
    const differences = new Map<InvoiceDifference, number>();
    let ordered = 0;
    let matched = 0;
    let discrepancies = 0;
    for (const row of rows) {
      if (row.orderQty !== null) ordered++;
      if (row.orderQty !== null && row.invoiceQty !== null && !row.differences.includes('ambiguous')) matched++;
      if (hasInvoiceDiscrepancy(row)) discrepancies++;
      for (const difference of row.differences) {
        differences.set(difference, (differences.get(difference) ?? 0) + 1);
      }
    }
    return { differences, ordered, matched, discrepancies };
  }, [rows]);
  const originals = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const effective = useMemo(() => adjustments.map((base) => {
    const draft = drafts.get(base.id);
    if (!draft) return base;
    const row = {
      ...base,
      qty: draft.qty === undefined ? base.qty : editableNumber(draft.qty),
      price: draft.price === undefined ? base.price : editableNumber(draft.price),
      included: draft.included ?? base.included,
    };
    return { ...row, amount: adjustmentAmount(row, originals.get(row.id)!) };
  }), [adjustments, drafts, originals]);
  const checked = effective.filter((row) => row.included);
  const invalidNumbers = checked.filter((row) =>
    !validNumber(row.qty) || !validNumber(row.price) || !validNumber(row.amount),
  );
  const unidentified = checked.filter((row) => !row.article.trim() && !row.name.trim());
  const conflicts = conflictingInvoiceAdjustments(checked);
  const exportDisabled = incomplete || Boolean(action) || checked.length === 0 ||
    invalidNumbers.length > 0 || unidentified.length > 0 || conflicts.length > 0;
  const activeFilter = !incomplete && filter === 'unconfirmed' ? 'all' : filter;
  const visibleRows = rows.filter((row) => matchesItem(row, query) && matchesPresence(row, presence) && (
    activeFilter === 'all' || (
      activeFilter === 'problems' ? hasInvoiceDiscrepancy(row) :
        activeFilter === 'total' ? hasInvoiceAmountDifference(row) : row.differences.includes(activeFilter as InvoiceDifference)
    )
  ));
  const visibleAdjustments = effective.filter((row) => matchesItem(row, editQuery) &&
    matchesPresence(originals.get(row.id)!, adjustmentPresence) && (
    includedFilter === 'all' || row.included === (includedFilter === 'included')
  ));
  const visibleIncluded = visibleAdjustments.filter((row) => row.included).length;
  const hiddenIncluded = checked.length - visibleIncluded;
  const defaultIncluded = new Set(adjustments.filter((row) => row.included).map((row) => row.id));
  const bulkCandidates = visibleAdjustments.filter((row) => !row.included && defaultIncluded.has(row.id) &&
    validNumber(row.qty) && validNumber(row.price) && validNumber(row.amount));
  const bulkConflicts = new Set(conflictingInvoiceAdjustments([
    ...checked, ...bulkCandidates.map((row) => ({ ...row, included: true })),
  ]).map((row) => row.id));
  const bulkIncluded = bulkCandidates.filter((row) => !bulkConflicts.has(row.id));
  const fileBase = safeFilename(supplier.slice(0, 110));

  function edit(id: string, change: AdjustmentDraft) {
    const next = new Map(drafts);
    next.set(id, { ...next.get(id), ...change });
    setCopyNotice('');
    onChange({ drafts: next });
  }

  function markVisible(rows: readonly InvoiceAdjustment[], included: boolean) {
    const next = new Map(drafts);
    for (const row of rows) next.set(row.id, { ...next.get(row.id), included });
    setCopyNotice('');
    onChange({ drafts: next });
  }

  function applyMode(nextMode: AdjustmentMode) {
    if (nextMode === mode) return;
    const apply = () => {
      setCopyNotice('');
      onChange({ mode: nextMode, adjustments: buildInvoiceAdjustments(rows, nextMode), drafts: new Map() });
    };
    if (drafts.size > 0) {
      confirmReplace('Смена режима пересоберёт корректировку и сбросит ручные правки.', 'Сменить режим', apply);
    } else {
      apply();
    }
  }

  function downloadReport() {
    void runVerified(
      'Выгрузка CSV…',
      () => save(new Blob([invoiceComparisonCsv(rows)], { type: csvType }), `Сверка__${fileBase}.csv`),
      'Не удалось скачать результат сверки. Повторите выгрузку.',
    );
  }

  function downloadCorrection(format: 'csv' | 'xls') {
    if (exportDisabled) return;
    setCopyNotice('');
    void runVerified(
      'Выгрузка для 1С…',
      () => {
        const contents = format === 'csv' ? invoiceAdjustmentCsv(effective) : invoiceAdjustmentWorkbook(effective);
        const type = format === 'csv' ? csvType : 'application/vnd.ms-excel';
        save(new Blob([contents], { type }), `Корректировка_1С__${fileBase}.${format}`);
        onExported();
      },
      'Не удалось скачать корректировку. Повторите выгрузку.',
    );
  }

  function copyCorrection() {
    if (exportDisabled) return;
    setCopyNotice('');
    void runVerified('Копирование…', async (isCurrent) => {
      const text = invoiceAdjustmentTsv(effective);
      try {
        await navigator.clipboard.writeText(text);
        if (isCurrent()) {
          onExported();
          setCopyNotice('Таблица скопирована. Вставьте её в Excel или загрузочную таблицу 1С.');
        }
      } catch {
        if (isCurrent()) setCopyFallback(text);
      }
    }, 'Не удалось подготовить таблицу для копирования.');
  }

  const adjustmentColumns: VirtualColumn<InvoiceAdjustment>[] = [
    {
      key: 'included', header: 'Вкл.', width: '55px',
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`Включить в экспорт ${itemLabel(row)}`}
          checked={row.included}
          onChange={(event) => edit(row.id, { included: event.target.checked })}
        />
      ),
    },
    {
      key: 'article', header: 'Артикул', width: '110px',
      render: (row) => <span className="invoice-code">{row.article || '—'}</span>,
    },
    {
      key: 'item', header: 'Номенклатура', width: 'minmax(160px, 1fr)',
      render: (row) => <ItemName row={row} />,
    },
    { key: 'unit', header: 'Ед.', width: '58px', render: (row) => row.unit || '—' },
    {
      key: 'qty', header: 'Количество', width: '112px', className: 'num',
      render: (row) => (
        <Input
          type="text"
          inputMode="decimal"
          aria-label={`Количество · ${itemLabel(row)}`}
          aria-invalid={row.included && !validNumber(row.qty) ? true : undefined}
          aria-describedby={row.included && !validNumber(row.qty) ? 'invoice-adjustment-errors' : undefined}
          value={drafts.get(row.id)?.qty ?? editableText(row.qty)}
          onChange={(event) => edit(row.id, { qty: event.target.value })}
        />
      ),
    },
    {
      key: 'price', header: 'Цена за ед.', width: '115px', className: 'num',
      render: (row) => (
        <Input
          type="text"
          inputMode="decimal"
          aria-label={`Цена · ${itemLabel(row)}`}
          aria-invalid={row.included && !validNumber(row.price) ? true : undefined}
          aria-describedby={row.included && !validNumber(row.price) ? 'invoice-adjustment-errors' : undefined}
          value={drafts.get(row.id)?.price ?? editableText(row.price)}
          onChange={(event) => edit(row.id, { price: event.target.value })}
        />
      ),
    },
    {
      key: 'amount', header: 'Сумма', width: '112px', className: 'num invoice-emphasis',
      render: (row) => display(row.amount, money),
    },
    {
      key: 'status', header: 'По итогам сверки', width: 'minmax(145px, .65fr)',
      render: (row) => <DifferenceList row={originals.get(row.id)!} />,
    },
  ];

  return (
    <>
      <section className="panel invoice-result" aria-labelledby="invoice-result-heading">
        <div className="section-heading">
          <div>
            <h2 id="invoice-result-heading">Результат сверки</h2>
            <p>{supplier} · {fileName}</p>
          </div>
          <Button className="secondary" disabled={Boolean(action)} onClick={downloadReport}>
            <BrandIcon name="download" />
            Скачать результат CSV
          </Button>
        </div>

        {incomplete && <Alert tone="warning">Результат неполный. Суммы и расхождения рассчитаны по прочитанным строкам.</Alert>}
        <div className="metrics">
          <MetricCard label="Позиций в заказе" value={fmtQty(counts.ordered)} icon="list" />
          <MetricCard label="Найдено в счёте" value={fmtQty(counts.matched)} icon="check" tone="accent" />
          <MetricCard
            label="С расхождениями"
            value={fmtQty(counts.discrepancies)}
            icon="warning"
            tone={counts.discrepancies ? 'warning' : 'success'}
          />
          <MetricCard
            label="Лишнее в счёте"
            value={fmtQty(counts.differences.get('extra') ?? 0)}
            icon="file"
          />
        </div>
        <div className="metrics metrics-three" role="group" aria-label="Суммы сверки">
          <MetricCard label="Сумма заказов" value={display(amounts.orderAmount, money)} />
          <MetricCard label="Сумма счетов" value={display(amounts.invoiceAmount, money)} />
          <MetricCard label="Разница суммы" value={display(amounts.difference, signedMoney)}
            tone={amounts.difference !== null && amounts.difference !== 0 ? 'warning' : 'neutral'}
            note={amounts.difference === null ? 'Не хватает данных о суммах' : 'Счета минус заказы · по всем позициям'} />
        </div>
        <div className="invoice-filters">
          <label className="filter-search">
            Поиск по результату
            <SearchInput
              type="search"
              aria-label="Поиск по результату"
              placeholder="Код 1С, артикул или наименование"
              value={query}
              onValueChange={setQuery}
            />
          </label>
          <label>
            Расхождения
            <Select value={activeFilter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">Все позиции ({fmtQty(rows.length)})</option>
              <option value="problems">С расхождениями ({fmtQty(counts.discrepancies)})</option>
              <option value="total">Разница суммы ({fmtQty(rows.filter(hasInvoiceAmountDifference).length)})</option>
              {Object.entries(invoiceDifferenceLabels).filter(([value]) => value !== 'unconfirmed' || incomplete).map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({fmtQty(counts.differences.get(value as InvoiceDifference) ?? 0)})
                </option>
              ))}
            </Select>
          </label>
          <PresenceFilter value={presence} onChange={setPresence} />
          <small className="invoice-count">Показано {fmtQty(visibleRows.length)} из {fmtQty(rows.length)}</small>
        </div>
        <small>В числовых колонках сверху заказ, ниже счёт и разница.</small>
        <VirtualTable
          rows={visibleRows}
          columns={comparisonColumns}
          getRowKey={(row) => row.id}
          emptyMessage="По заданным фильтрам нет позиций."
        />
      </section>

      <section className="panel invoice-result" aria-labelledby="invoice-adjust-heading">
        <h2 id="invoice-adjust-heading">Корректировка и экспорт в 1С</h2>
        <p>Проверьте количества и цены. В экспорт попадут все отмеченные строки, включая скрытые фильтрами.</p>
        <div className="metrics metrics-three">
          <MetricCard label="Включено позиций" value={fmtQty(checked.length)} icon="check" tone="accent" />
          <MetricCard label="Итоговая сумма" value={invalidNumbers.length ? '—' : money(moneySum(checked.map((row) => row.amount!)))} />
          <MetricCard label="Исключено позиций" value={fmtQty(effective.length - checked.length)} />
        </div>
        <div className="invoice-filters">
          <label>
            Режим корректировки
            <Select value={mode} onChange={(event) => applyMode(event.target.value as AdjustmentMode)}>
              <option value="invoice">Количество и цены из счёта</option>
              <option value="order">Количество из заказа, цены из счёта</option>
            </Select>
          </label>
          <label className="filter-search">
            Поиск по корректировке
            <SearchInput
              type="search"
              aria-label="Поиск по корректировке"
              placeholder="Код 1С, артикул или наименование"
              value={editQuery}
              onValueChange={setEditQuery}
            />
          </label>
          <label>
            Участие в экспорте
            <Select value={includedFilter} onChange={(event) => setIncludedFilter(event.target.value)}>
              <option value="all">Все позиции</option>
              <option value="included">Включённые</option>
              <option value="excluded">Исключённые</option>
            </Select>
          </label>
          <PresenceFilter value={adjustmentPresence} onChange={setAdjustmentPresence} />
          <small className="invoice-count">Показано {fmtQty(visibleAdjustments.length)} из {fmtQty(effective.length)}</small>
        </div>
        <div className="invoice-actions">
          <Button className="secondary" disabled={!bulkIncluded.length || Boolean(action)} onClick={() => markVisible(bulkIncluded, true)}>
            Включить подходящие по фильтру ({fmtQty(bulkIncluded.length)})
          </Button>
          <Button className="secondary" disabled={!visibleIncluded || Boolean(action)} onClick={() => markVisible(visibleAdjustments.filter((row) => row.included), false)}>
            Снять отметки по фильтру ({fmtQty(visibleIncluded)})
          </Button>
        </div>
        <VirtualTable
          rowClassName="invoice-adjustment-row"
          rows={visibleAdjustments}
          columns={adjustmentColumns}
          getRowKey={(row) => row.id}
          emptyMessage="По заданным фильтрам нет позиций."
        />
        {invalidNumbers.length > 0 && (
          <div id="invoice-adjustment-errors">
            <Alert tone="warning">
              Экспорт недоступен. Укажите неотрицательные количество и цену и проверьте сумму либо исключите позиции с ошибками ({fmtQty(invalidNumbers.length)}).
            </Alert>
          </div>
        )}
        {unidentified.length > 0 && (
          <Alert tone="warning">
            Исключите из экспорта позиции без артикула и наименования ({fmtQty(unidentified.length)}). Эти данные нужны для загрузки в 1С.
          </Alert>
        )}
        {conflicts.length > 0 && (
          <Alert tone="warning">
            Отмеченные позиции неразличимы для 1С. Оставьте одну строку на артикул, наименование и единицу.
            {' '}{conflicts.slice(0, 3).map(itemLabel).join(', ')}{conflicts.length > 3 ? '…' : '.'}
          </Alert>
        )}
        <div className="invoice-actions invoice-export-actions">
          <small aria-live="polite">Включено {fmtQty(checked.length)} · скрыто фильтрами {fmtQty(hiddenIncluded)}</small>
          <Button disabled={exportDisabled} onClick={copyCorrection}>
            Скопировать для 1С
          </Button>
          <Button className="secondary" disabled={exportDisabled} onClick={() => downloadCorrection('csv')}>
            <BrandIcon name="download" />
            CSV для 1С
          </Button>
          <Button className="secondary" disabled={exportDisabled} onClick={() => downloadCorrection('xls')}>
            <BrandIcon name="download" />
            Excel для 1С
          </Button>
        </div>
        {checked.length === 0 && <p>Отметьте хотя бы одну позицию для экспорта.</p>}
        {action && action !== 'Сверка…' && <div role="status" className="sr-only">{action}</div>}
        {copyNotice && <Alert>{copyNotice}</Alert>}
      </section>

      {copyFallback && (
        <Dialog
          title="Скопировать для 1С"
          onClose={() => setCopyFallback('')}
          actions={<Button onClick={() => setCopyFallback('')}>Закрыть</Button>}
        >
          <p>Браузер не разрешил автоматическое копирование. Выделите таблицу и нажмите Ctrl+C.</p>
          <textarea
            className="input invoice-copy resize-none"
            aria-label="Таблица для вставки в 1С"
            value={copyFallback}
            readOnly
            rows={6}
            style={{ resize: 'none' }}
            onFocus={(event) => event.target.select()}
          />
        </Dialog>
      )}
    </>
  );
}

type Item = Pick<InvoiceComparisonRow, 'skuCode' | 'article' | 'name'>;

function itemLabel(row: Item): string {
  return [row.article, row.name, row.skuCode].filter(Boolean).join(' · ') || 'позицию без артикула';
}

function matchesItem(row: Item, query: string): boolean {
  return itemLabel(row).toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'));
}

function ItemName({ row }: { row: Item }) {
  return (
    <div className="invoice-identity">
      <strong>{row.name || 'Без наименования'}</strong>
      {row.skuCode && <small>Код 1С {row.skuCode}</small>}
    </div>
  );
}

function DifferenceList({ row }: { row: InvoiceComparisonRow }) {
  const { differences } = row;
  const amountDiffers = hasInvoiceAmountDifference(row);
  return (
    <div className="invoice-differences">
      {differences.length === 0 && !amountDiffers ? <span className="badge OK">Совпадает</span> :
        differences.map((difference) => (
          <span
            key={difference}
            className={`badge ${difference === 'lower' ? 'OK' : difference === 'quantity' ? 'YELLOW' : 'LIGHT_RED'}`}
          >
            {invoiceDifferenceLabels[difference]}
          </span>
        ))
      }
      {amountDiffers && <span className="badge YELLOW">Сумма отличается</span>}
      {invoicePriceWithinTolerance(row) && <small>Цена в пределах допуска 0,01 ₽ за единицу.</small>}
    </div>
  );
}

function display(value: number | null, format: (n: number) => string): string {
  return value === null ? '—' : format(value);
}

function signedMoney(value: number): string {
  return `${value > 0 ? '+' : ''}${money(value)}`;
}

function ValueWithDelta({
  value,
  orderValue,
  format,
}: {
  value: number | null;
  orderValue: number | null;
  format: (n: number) => string;
}) {
  const difference = value === null || orderValue === null ? null : moneySum([value, -orderValue]);
  return (
    <div className="invoice-identity">
      <strong>{display(value, format)}</strong>
      {difference !== null && difference !== 0 && (
        <small>
          <span className="sr-only">Разница </span>
          {difference > 0 ? '+' : ''}{format(difference)}
        </small>
      )}
    </div>
  );
}

function validNumber(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function editableText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

function editableNumber(text: string): number | null {
  const value = text.trim();
  if (!/^(?:(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  return parseOptionalNumber(value);
}

function matchesPresence(row: InvoiceComparisonRow, value: string): boolean {
  if (value === 'invoice') return row.invoiceQty !== null;
  if (value === 'missing') return row.differences.includes('missing');
  if (value === 'extra') return row.differences.includes('extra');
  return true;
}

function PresenceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label>
      Наличие в счёте
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">Все позиции</option>
        <option value="invoice">Есть в счёте</option>
        <option value="missing">Нет в счёте</option>
        <option value="extra">Только в счёте</option>
      </Select>
    </label>
  );
}

function InvoiceRowDetails({ row }: { row: InvoiceComparisonRow }) {
  return (row.notes.length > 0 || row.invoiceSources?.length) ? (
    <details className="invoice-row-details">
      <summary>Пояснения и источники</summary>
      {row.invoiceSources && <ul>{row.invoiceSources.map((item) => (
        <li key={JSON.stringify([item.sourceFileId, item.sourceSheet, item.sourceRow])}>
          {item.sourceFile}{item.sourceSheet && ` · ${item.sourceSheet}`} · строка {item.sourceRow}
          <br />{fmtQty(item.quantity)} {item.unit ?? ''} · цена {display(item.price, money)}
          {' · сумма '}{display(item.amount ?? (item.price === null ? null : moneyProduct(item.quantity, item.price)), money)}
        </li>
      ))}</ul>}
      {row.notes.filter((note) => !note.startsWith('Источник счёта:')).map((note, index) => <small key={index}>{note}</small>)}
    </details>
  ) : null;
}

function OrderAndInvoiceValues({ order, invoice, format }: {
  order: number | null; invoice: number | null; format: (value: number) => string;
}) {
  return (
    <div className="invoice-value-pair">
      <small title="Заказ">{display(order, format)}</small>
      <ValueWithDelta value={invoice} orderValue={order} format={format} />
    </div>
  );
}

const comparisonColumns: VirtualColumn<InvoiceComparisonRow>[] = [
  {
    key: 'article', header: 'Артикул', width: '100px', sticky: true,
    render: (row) => <span className="invoice-code">{row.article || '—'}</span>,
  },
  {
    key: 'item', header: 'Номенклатура', width: 'minmax(175px, 1fr)', sticky: true,
    render: (row) => <ItemName row={row} />,
  },
  { key: 'unit', header: 'Ед.', width: '50px', render: (row) => row.unit || '—' },
  {
    key: 'qty', header: 'Количество', width: '110px', className: 'num',
    render: (row) => <OrderAndInvoiceValues order={row.orderQty} invoice={row.invoiceQty} format={fmtQty} />,
  },
  {
    key: 'price', header: 'Цена за ед.', width: '140px', className: 'num',
    render: (row) => <OrderAndInvoiceValues order={row.orderPrice} invoice={row.invoicePrice} format={money} />,
  },
  {
    key: 'amount', header: 'Сумма', width: '145px', className: 'num',
    render: (row) => <OrderAndInvoiceValues order={row.orderAmount} invoice={row.invoiceAmount} format={money} />,
  },
  {
    key: 'differences', header: 'Расхождения', width: 'minmax(145px, .8fr)',
    render: (row) => <><DifferenceList row={row} /><InvoiceRowDetails row={row} /></>,
  },
];
