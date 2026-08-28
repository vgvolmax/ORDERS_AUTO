import { useMemo, useState, type ReactNode } from 'react';
import { derive } from '../../app/selectors';
import { useStore } from '../../app/appStore';
import {
  emptyDemandFilters,
  FiltersBar,
  type DemandFilters,
} from '../../components/FiltersBar';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, MetricCard } from '../../components/ui';
import { VirtualTable, type VirtualColumn } from '../../components/VirtualTable';
import type { PricedDemandLine, StockStatus } from '../../domain/types';

interface NetworkGroup {
  skuCode: string;
  article: string | null;
  name: string;
  lines: PricedDemandLine[];
  worstStatus: StockStatus;
  deficitBranchCount: number;
  belowMinBranchCount: number;
  totalDeficitQty: number;
  totalDemandAmount: number;
  missingPriceCount: number;
  selectedSupplier: string | null;
}

const severity: Record<StockStatus, number> = {
  NO_NORM: 0,
  OK: 1,
  YELLOW: 2,
  ORANGE: 3,
  LIGHT_RED: 4,
  BELOW_MIN: 5,
  INVALID_NORM: 6,
};

export function DemandPage({ branch }: { branch?: string | undefined }) {
  const { state } = useStore();
  const derived = derive(state)!;
  const [filters, setFilters] = useState<DemandFilters>(emptyDemandFilters);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  const supplierOptions = useMemo(
    () => state.suppliers?.suppliers ?? [],
    [state.suppliers],
  );
  const orderLineKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const order of derived.projection.orders) {
      for (const line of order.lines) {
        if (line.orderQty > 0) {
          keys.add(`${line.skuCode}\0${line.branch}`);
        }
      }
    }
    return keys;
  }, [derived.projection.orders]);

  const scopedLines = derived.demand.filter((line) => !branch || line.branch === branch);
  const invalidNormCount = scopedLines.filter((line) => line.status === 'INVALID_NORM').length;
  const noNormCount = scopedLines.filter((line) => line.status === 'NO_NORM').length;

  if (!branch) {
    const groups = filterNetworkGroups(
      buildNetworkGroups(derived.demand),
      filters,
      orderLineKeys,
    );
    const qty = groups.reduce((sum, group) => sum + group.totalDeficitQty, 0);
    const amount = groups.reduce((sum, group) => sum + group.totalDemandAmount, 0);
    const missing = groups.reduce((sum, group) => sum + group.missingPriceCount, 0);
    const belowMin = groups.filter((group) => group.belowMinBranchCount > 0).length;

    const columns: VirtualColumn<NetworkGroup>[] = [
      {
        key: 'status',
        header: 'Статус',
        width: '150px',
        render: (group) => <StatusBadge status={group.worstStatus} />,
      },
      { key: 'article', header: 'Артикул', width: '130px', render: (group) => group.article ?? '—' },
      { key: 'code', header: 'Код', width: '135px', render: (group) => <strong>{group.skuCode}</strong> },
      {
        key: 'name',
        header: 'Товар',
        width: 'minmax(240px, 1.8fr)',
        render: (group) => (
          <button
            className="row-expand"
            onClick={() => setExpandedSku(expandedSku === group.skuCode ? null : group.skuCode)}
          >
            <span>{group.name}</span>
            <small>{expandedSku === group.skuCode ? 'Скрыть подразделения' : 'Показать подразделения'}</small>
          </button>
        ),
      },
      { key: 'branches', header: 'Подразделений', width: '115px', className: 'num', render: (group) => group.deficitBranchCount },
      { key: 'below', header: 'Ниже MIN', width: '95px', className: 'num', render: (group) => group.belowMinBranchCount },
      { key: 'qty', header: 'Потребность', width: '115px', className: 'num', render: (group) => fmtQty(group.totalDeficitQty) },
      { key: 'amount', header: 'Потребность, ₽', width: '155px', className: 'num', render: (group) => amountWithMissing(group.totalDemandAmount, group.missingPriceCount) },
      { key: 'supplier', header: 'Поставщик / статус', width: '190px', render: (group) => group.selectedSupplier ?? 'Требует решения' },
    ];

    return (
      <Workspace
        title="Потребность всей сети"
        subtitle="Одна строка на товар. Раскройте товар, чтобы увидеть распределение по подразделениям."
      >
        <Metrics count={groups.length} below={belowMin} qty={qty} sum={amount} missing={missing} />
        <NormAlerts invalid={invalidNormCount} missing={noNormCount} />
        <FiltersBar value={filters} onChange={setFilters} suppliers={supplierOptions} resultCount={groups.length} />
        <VirtualTable
          rows={groups}
          columns={columns}
          getRowKey={(group) => group.skuCode}
          renderDetails={(group) =>
            expandedSku === group.skuCode ? <NetworkDetails group={group} /> : null
          }
        />
      </Workspace>
    );
  }

  const rows = filterBranchLines(scopedLines, filters, orderLineKeys).sort(
    (left, right) => severity[right.status] - severity[left.status],
  );
  const qty = rows.reduce((sum, line) => sum + line.deficitQty, 0);
  const amount = rows.reduce((sum, line) => sum + (line.demandAmount ?? 0), 0);
  const missing = rows.filter((line) => line.deficitQty > 0 && line.demandAmount == null).length;
  const belowMin = rows.filter((line) => line.status === 'BELOW_MIN').length;

  const columns: VirtualColumn<PricedDemandLine>[] = [
    { key: 'status', header: 'Статус', width: '145px', render: (line) => <StatusBadge status={line.status} /> },
    { key: 'article', header: 'Артикул', width: '120px', render: (line) => line.article ?? '—' },
    { key: 'code', header: 'Код', width: '130px', render: (line) => <strong>{line.skuCode}</strong> },
    { key: 'name', header: 'Номенклатура', width: 'minmax(240px, 1.5fr)', render: (line) => line.name },
    { key: 'stock', header: 'Остаток', width: '85px', className: 'num', render: (line) => fmtQty(line.stock) },
    { key: 'min', header: 'MIN', width: '75px', className: 'num', render: (line) => line.min ?? '—' },
    { key: 'max', header: 'MAX', width: '75px', className: 'num', render: (line) => line.max ?? '—' },
    { key: 'pct', header: 'Не хватает %', width: '105px', className: 'num', render: (line) => line.deficitPct == null ? '—' : `${Math.round(line.deficitPct * 100)}%` },
    { key: 'localQty', header: 'Нужно сюда', width: '105px', className: 'num', render: (line) => fmtQty(line.deficitQty) },
    { key: 'networkQty', header: 'Нужно всей сети', width: '125px', className: 'num', render: (line) => fmtQty(line.networkDeficitQty) },
    { key: 'localAmount', header: '₽ сюда', width: '125px', className: 'num', render: (line) => line.demandAmount == null ? 'Нет цены' : money(line.demandAmount) },
    { key: 'networkAmount', header: '₽ всей сети', width: '145px', className: 'num', render: (line) => amountWithMissing(line.networkDemandAmount, line.networkMissingPriceCount) },
    { key: 'supplier', header: 'Поставщик', width: '175px', render: (line) => line.selectedSupplier ?? 'Не выбран' },
    { key: 'source', header: 'Источник цены', width: '125px', render: (line) => priceSourceLabel(line.priceSource) },
  ];

  return (
    <Workspace
      title={branch}
      subtitle="Потребность подразделения до MAX. Критичные позиции автоматически подняты выше."
    >
      <Metrics count={rows.length} below={belowMin} qty={qty} sum={amount} missing={missing} />
      <NormAlerts invalid={invalidNormCount} missing={noNormCount} />
      <FiltersBar value={filters} onChange={setFilters} suppliers={supplierOptions} resultCount={rows.length} />
      <VirtualTable
        rows={rows}
        columns={columns}
        getRowKey={(line) => `${line.skuCode}:${line.branch}`}
        emptyMessage="Все позиции подразделения находятся на MAX или выше либо исключены текущими фильтрами."
      />
    </Workspace>
  );
}

function buildNetworkGroups(lines: PricedDemandLine[]): NetworkGroup[] {
  const grouped = new Map<string, PricedDemandLine[]>();
  for (const line of lines.filter((item) => item.deficitQty > 0)) {
    const bucket = grouped.get(line.skuCode) ?? [];
    bucket.push(line);
    grouped.set(line.skuCode, bucket);
  }

  return [...grouped.entries()].map(([skuCode, groupLines]) => ({
    skuCode,
    article: groupLines[0]!.article,
    name: groupLines[0]!.name,
    lines: groupLines,
    worstStatus: groupLines.reduce(
      (worst, line) => (severity[line.status] > severity[worst] ? line.status : worst),
      groupLines[0]!.status,
    ),
    deficitBranchCount: groupLines.length,
    belowMinBranchCount: groupLines.filter((line) => line.status === 'BELOW_MIN').length,
    totalDeficitQty: groupLines.reduce((sum, line) => sum + line.deficitQty, 0),
    totalDemandAmount: groupLines[0]!.networkDemandAmount,
    missingPriceCount: groupLines[0]!.networkMissingPriceCount,
    selectedSupplier: groupLines[0]!.selectedSupplier,
  }));
}

function filterNetworkGroups(
  groups: NetworkGroup[],
  filters: DemandFilters,
  orderLineKeys: Set<string>,
): NetworkGroup[] {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  return groups.filter((group) => {
    if (query && !`${group.skuCode} ${group.article ?? ''} ${group.name}`.toLocaleLowerCase('ru-RU').includes(query)) return false;
    if (filters.status !== 'ALL' && group.worstStatus !== filters.status) return false;
    if (filters.supplier === '__UNASSIGNED__' && group.selectedSupplier) return false;
    if (filters.supplier && filters.supplier !== '__UNASSIGNED__' && group.selectedSupplier !== filters.supplier) return false;
    if (!passesMoney(group.totalDemandAmount, filters)) return false;
    if (filters.onlyInOrders && !group.lines.some((line) => orderLineKeys.has(`${line.skuCode}\0${line.branch}`))) return false;
    if (filters.problemsOnly && !group.lines.some(hasProblem)) return false;
    return true;
  });
}

function filterBranchLines(
  lines: PricedDemandLine[],
  filters: DemandFilters,
  orderLineKeys: Set<string>,
): PricedDemandLine[] {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  return lines.filter((line) => {
    const explicitlyLookingForInvalid = filters.status === 'INVALID_NORM';
    if (!(line.deficitQty > 0 || (explicitlyLookingForInvalid && line.status === 'INVALID_NORM'))) return false;
    if (query && !`${line.skuCode} ${line.article ?? ''} ${line.name}`.toLocaleLowerCase('ru-RU').includes(query)) return false;
    if (filters.status !== 'ALL' && line.status !== filters.status) return false;
    if (filters.supplier === '__UNASSIGNED__' && line.selectedSupplier) return false;
    if (filters.supplier && filters.supplier !== '__UNASSIGNED__' && line.selectedSupplier !== filters.supplier) return false;
    if (!passesMoney(line.demandAmount ?? 0, filters)) return false;
    if (filters.onlyInOrders && !orderLineKeys.has(`${line.skuCode}\0${line.branch}`)) return false;
    if (filters.problemsOnly && !hasProblem(line)) return false;
    return true;
  });
}

function passesMoney(amount: number, filters: DemandFilters): boolean {
  const from = filters.amountFrom === '' ? null : Number(filters.amountFrom);
  const to = filters.amountTo === '' ? null : Number(filters.amountTo);
  return (from == null || amount >= from) && (to == null || amount <= to);
}

function hasProblem(line: PricedDemandLine): boolean {
  return (
    line.unitPrice == null ||
    line.supplierResolutionStatus === 'MANUAL_REQUIRED' ||
    line.supplierResolutionStatus === 'UNRESOLVED' ||
    line.supplierResolutionStatus === 'STALE_OVERRIDE'
  );
}

function NetworkDetails({ group }: { group: NetworkGroup }) {
  return (
    <div className="network-details">
      {group.lines.map((line) => (
        <div key={line.branch} className="network-detail-item">
          <strong>{line.branch}</strong>
          <span>Остаток {fmtQty(line.stock)}</span>
          <span>MIN {line.min ?? '—'}</span>
          <span>MAX {line.max ?? '—'}</span>
          <span>Нужно {fmtQty(line.deficitQty)}</span>
          <span>{line.demandAmount == null ? 'Нет цены' : money(line.demandAmount)}</span>
        </div>
      ))}
    </div>
  );
}

function NormAlerts({ invalid, missing }: { invalid: number; missing: number }) {
  if (invalid === 0 && missing === 0) return null;
  return (
    <div className="alert-stack">
      {invalid > 0 && <Alert tone="danger">Ошибка MIN/MAX у {invalid} строк. Они не попадут в заказ до исправления норматива.</Alert>}
      {missing > 0 && <Alert tone="warning">Нет MAX-норматива у {missing} строк. Потребность для них не рассчитывается.</Alert>}
    </div>
  );
}

function Metrics({ count, below, qty, sum, missing }: { count: number; below: number; qty: number; sum: number; missing: number }) {
  return (
    <div className="metrics">
      <MetricCard label="SKU ниже MAX" value={count} />
      <MetricCard label="SKU ниже MIN" value={below} />
      <MetricCard label="Нужно заказать" value={fmtQty(qty)} />
      <MetricCard label="Известная сумма" value={money(sum)} note={missing > 0 ? `Без цены: ${missing}` : null} />
    </div>
  );
}

function Workspace({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main>
      <header>
        <p className="eyebrow">Потребность</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      {children}
    </main>
  );
}

function amountWithMissing(amount: number, missing: number) {
  return (
    <span>
      {money(amount)}
      {missing > 0 && <small>+ {missing} строк без цены</small>}
    </span>
  );
}

export function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(value);
}

export function fmtQty(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

export function priceSourceLabel(source: PricedDemandLine['priceSource']): string {
  if (source === 'SUPPLIER_HISTORY') return 'История закупок';
  if (source === 'MIN_MAX_FALLBACK') return 'Цена MIN/MAX';
  return 'Нет цены';
}
