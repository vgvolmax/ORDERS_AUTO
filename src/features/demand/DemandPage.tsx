import { useMemo, type ReactNode } from 'react';
import { useDerivedState } from '../../app/useDerivedState';
import { usePreference } from '../../app/usePreference';
import { useTablePreferences } from '../../app/tablePreferences';
import { QuantitySummary } from '../../components/QuantitySummary';
import { money, fmtQty } from '../../format/numbers';
export { money, fmtQty } from '../../format/numbers';
import { MovementIndicator } from '../rebalancing/AcceptedMovementsPopover';
import type { PurchaseDemandLine } from '../../domain/purchaseDemand';
import { isSupplierInPool } from '../../domain/supplierPool';
import { useStore } from '../../app/appStore';
import {
  emptyDemandFilters,
  FiltersBar,
  type DemandFilters,
} from '../../components/FiltersBar';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, MetricCard } from '../../components/ui';
import {
  VirtualTable,
  type VirtualColumn,
} from '../../components/VirtualTable';
import type { PricedDemandLine, StockStatus } from '../../domain/types';

type DiagnosticNormStatus = 'NO_NORM' | 'INVALID_NORM';

interface NetworkGroup {
  skuCode: string;
  article: string | null;
  name: string;
  lines: PurchaseDemandLine[];
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
  const derived = useDerivedState(state);
  const tablePreferences = useTablePreferences(
    `demand:${branch ?? 'all'}:table`,
  );
  const [savedFilters, setFilters] = usePreference<DemandFilters>(
    `demand:${branch ?? 'all'}:filters`,
    emptyDemandFilters,
  );
  const filters =
    savedFilters.supplier &&
    savedFilters.supplier !== '__UNASSIGNED__' &&
    !isSupplierInPool(savedFilters.supplier)
      ? { ...savedFilters, supplier: '' }
      : savedFilters;
  const [showCovered, setShowCovered] = usePreference(
    `demand:${branch ?? 'all'}:covered`,
    false,
  );
  const [expandedSku, setExpandedSku] = usePreference<string | null>(
    'demand:expanded',
    null,
  );

  const supplierOptions = useMemo(
    () => state.suppliers?.suppliers.filter(isSupplierInPool) ?? [],
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

  const scopedLines = derived.purchaseDemand.filter(
    (line) => !branch || line.branch === branch,
  );
  const invalidNormCount = scopedLines.filter(
    (line) => line.purchaseStatus === 'INVALID_NORM',
  ).length;
  const noNormCount = scopedLines.filter(
    (line) => line.purchaseStatus === 'NO_NORM',
  ).length;

  if (!branch) {
    const diagnosticStatus = getDiagnosticNormStatus(filters.status);
    const groups = filterNetworkGroups(
      buildNetworkGroups(derived.purchaseDemand, diagnosticStatus, showCovered),
      filters,
      orderLineKeys,
    );
    const amount = groups.reduce(
      (sum, group) => sum + group.totalDemandAmount,
      0,
    );
    const missing = groups.reduce(
      (sum, group) => sum + group.missingPriceCount,
      0,
    );
    const belowMin = groups.filter(
      (group) => group.belowMinBranchCount > 0,
    ).length;

    const columns: VirtualColumn<NetworkGroup>[] = [
      {
        key: 'code',
        header: 'Код',
        width: '120px',
        sticky: true,
        hideable: false,
        sortValue: (group) => group.skuCode,
        render: (group) => <strong>{group.skuCode}</strong>,
      },
      {
        key: 'article',
        header: 'Артикул',
        width: '110px',
        sticky: true,
        hideable: false,
        sortValue: (group) => group.article,
        render: (group) => group.article ?? '—',
      },
      {
        key: 'name',
        header: 'Наименование',
        width: 'minmax(240px, 1.8fr)',
        sticky: true,
        hideable: false,
        sortValue: (group) => group.name,
        render: (group) => (
          <button
            className="row-expand"
            onClick={() =>
              setExpandedSku(
                expandedSku === group.skuCode ? null : group.skuCode,
              )
            }
          >
            <span>{group.name}</span>
            <small>
              {expandedSku === group.skuCode
                ? 'Скрыть подразделения'
                : 'Показать подразделения'}
            </small>
          </button>
        ),
      },
      {
        key: 'status',
        sortValue: (group) => severity[group.worstStatus],
        header: 'Статус',
        width: '150px',
        render: (group) => <StatusBadge status={group.worstStatus} />,
      },
      {
        key: 'branches',
        sortValue: (group) => group.deficitBranchCount,
        header: 'Подразделений',
        width: '115px',
        className: 'num',
        render: (group) => group.deficitBranchCount,
      },
      {
        key: 'below',
        sortValue: (group) => group.belowMinBranchCount,
        header: 'Ниже MIN',
        width: '95px',
        className: 'num',
        render: (group) => group.belowMinBranchCount,
      },
      {
        key: 'qty',
        sortValue: (group) => group.totalDeficitQty,
        header: 'Потребность',
        width: '115px',
        className: 'num',
        render: (group) => (
          <>
            {fmtQty(group.totalDeficitQty)}
            <MovementIndicator scope={{ skuCode: group.skuCode }} />
          </>
        ),
      },
      {
        key: 'amount',
        sortValue: (group) =>
          group.missingPriceCount ? null : group.totalDemandAmount,
        header: 'Потребность, ₽',
        width: '155px',
        className: 'num',
        render: (group) =>
          amountWithMissing(group.totalDemandAmount, group.missingPriceCount),
      },
      {
        key: 'supplier',
        sortValue: (group) => group.selectedSupplier,
        header: 'Поставщик / статус',
        width: '190px',
        render: (group) => group.selectedSupplier ?? 'Требует решения',
      },
    ];

    return (
      <Workspace
        title="Потребность всей сети"
        subtitle="Одна строка на товар. Раскройте товар, чтобы увидеть распределение по подразделениям."
      >
        <Metrics
          count={groups.length}
          below={belowMin}
          qty={
            <QuantitySummary
              rows={groups.flatMap((group) =>
                group.lines.map((line) => ({
                  skuCode: line.skuCode,
                  qty: line.purchaseQty,
                  unit: line.unit,
                })),
              )}
            />
          }
          sum={amount}
          missing={missing}
        />
        <NormAlerts invalid={invalidNormCount} missing={noNormCount} />
        <label className="checkbox-control">
          <input
            type="checkbox"
            checked={showCovered}
            onChange={(e) => setShowCovered(e.target.checked)}
          />
          Показать покрытые перемещениями
        </label>
        <FiltersBar
          value={filters}
          onChange={setFilters}
          suppliers={supplierOptions}
          resultCount={groups.length}
        />
        <VirtualTable
          {...tablePreferences}
          rows={groups}
          columns={columns}
          getRowKey={(group) => group.skuCode}
          renderDetails={(group) =>
            expandedSku === group.skuCode ? (
              <NetworkDetails group={group} />
            ) : null
          }
        />
      </Workspace>
    );
  }

  const rows = filterBranchLines(
    scopedLines,
    filters,
    orderLineKeys,
    showCovered,
  ).sort(
    (left, right) =>
      severity[right.purchaseStatus] - severity[left.purchaseStatus],
  );
  const amount = rows.reduce(
    (sum, line) => sum + (line.purchaseAmount ?? 0),
    0,
  );
  const missing = rows.filter(
    (line) => line.purchaseQty > 0 && line.purchaseAmount == null,
  ).length;
  const belowMin = rows.filter(
    (line) => line.purchaseStatus === 'BELOW_MIN',
  ).length;

  const columns: VirtualColumn<PurchaseDemandLine>[] = [
    {
      key: 'code',
      header: 'Код',
      width: '120px',
      sticky: true,
      hideable: false,
      sortValue: (line) => line.skuCode,
      render: (line) => <strong>{line.skuCode}</strong>,
    },
    {
      key: 'article',
      header: 'Артикул',
      width: '110px',
      sticky: true,
      hideable: false,
      sortValue: (line) => line.article,
      render: (line) => line.article ?? '—',
    },
    {
      key: 'name',
      header: 'Наименование',
      width: 'minmax(240px, 1.5fr)',
      sticky: true,
      hideable: false,
      sortValue: (line) => line.name,
      render: (line) => line.name,
    },
    {
      key: 'status',
      sortValue: (line) => severity[line.purchaseStatus],
      header: 'Статус',
      width: '145px',
      render: (line) => <StatusBadge status={line.purchaseStatus} />,
    },
    {
      key: 'stock',
      sortValue: (line) => line.stock,
      header: 'Остаток по отчёту',
      width: '120px',
      className: 'num',
      render: (line) => fmtQty(line.stock),
    },
    {
      key: 'min',
      sortValue: (line) => line.min,
      header: 'MIN',
      width: '75px',
      className: 'num',
      render: (line) => line.min ?? '—',
    },
    {
      key: 'max',
      sortValue: (line) => line.max,
      header: 'MAX',
      width: '75px',
      className: 'num',
      render: (line) => line.max ?? '—',
    },
    {
      key: 'pct',
      sortValue: (line) => line.purchaseDeficitPct,
      header: 'Не хватает %',
      width: '105px',
      className: 'num',
      render: (line) =>
        line.purchaseDeficitPct == null
          ? '—'
          : `${Math.round(line.purchaseDeficitPct * 100)}%`,
    },
    {
      key: 'localQty',
      sortValue: (line) => line.purchaseQty,
      header: 'Нужно сюда',
      width: '105px',
      className: 'num',
      render: (line) => (
        <>
          {fmtQty(line.purchaseQty)}
          <MovementIndicator
            scope={{ skuCode: line.skuCode, branch: line.branch }}
          />
        </>
      ),
    },
    {
      key: 'networkQty',
      sortValue: (line) => line.networkPurchaseQty,
      header: 'Нужно всей сети',
      width: '125px',
      className: 'num',
      render: (line) => fmtQty(line.networkPurchaseQty),
    },
    {
      key: 'localAmount',
      sortValue: (line) => line.purchaseAmount,
      header: '₽ сюда',
      width: '125px',
      className: 'num',
      render: (line) =>
        line.purchaseAmount == null ? 'Нет цены' : money(line.purchaseAmount),
    },
    {
      key: 'networkAmount',
      sortValue: (line) =>
        line.networkPurchaseMissingPriceCount
          ? null
          : line.networkPurchaseAmount,
      header: '₽ всей сети',
      width: '145px',
      className: 'num',
      render: (line) =>
        amountWithMissing(
          line.networkPurchaseAmount,
          line.networkPurchaseMissingPriceCount,
        ),
    },
    {
      key: 'supplier',
      sortValue: (line) => line.selectedSupplier,
      header: 'Поставщик',
      width: '175px',
      render: (line) => line.selectedSupplier ?? 'Не выбран',
    },
    {
      key: 'source',
      sortValue: (line) => priceSourceLabel(line.priceSource),
      header: 'Источник цены',
      width: '125px',
      render: (line) => priceSourceLabel(line.priceSource),
    },
  ];

  return (
    <Workspace
      title={branch}
      subtitle="Потребность подразделения до MAX. Критичные позиции автоматически подняты выше."
    >
      <Metrics
        count={rows.length}
        below={belowMin}
        qty={
          <QuantitySummary
            rows={rows.map((line) => ({
              skuCode: line.skuCode,
              qty: line.purchaseQty,
              unit: line.unit,
            }))}
          />
        }
        sum={amount}
        missing={missing}
      />
      <NormAlerts invalid={invalidNormCount} missing={noNormCount} />
      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={showCovered}
          onChange={(e) => setShowCovered(e.target.checked)}
        />
        Показать покрытые перемещениями
      </label>
      <FiltersBar
        value={filters}
        onChange={setFilters}
        suppliers={supplierOptions}
        resultCount={rows.length}
      />
      <VirtualTable
        {...tablePreferences}
        rows={rows}
        columns={columns}
        getRowKey={(line) => `${line.skuCode}:${line.branch}`}
        emptyMessage="Все позиции подразделения находятся на MAX или выше либо исключены текущими фильтрами."
      />
    </Workspace>
  );
}

function buildNetworkGroups(
  lines: PurchaseDemandLine[],
  diagnosticStatus: DiagnosticNormStatus | null = null,
  showCovered = false,
): NetworkGroup[] {
  const grouped = new Map<string, PurchaseDemandLine[]>();
  const groupableLines = diagnosticStatus
    ? lines.filter((item) => item.purchaseStatus === diagnosticStatus)
    : lines.filter(
        (item) =>
          item.purchaseQty > 0 ||
          (showCovered && item.acceptedTransferIds.length > 0),
      );

  for (const line of groupableLines) {
    const bucket = grouped.get(line.skuCode) ?? [];
    bucket.push(line);
    grouped.set(line.skuCode, bucket);
  }

  return [...grouped.entries()].map(([skuCode, groupLines]) => {
    const positiveLines = groupLines.filter((line) => line.purchaseQty > 0);
    return {
      skuCode,
      article: groupLines[0]!.article,
      name: groupLines[0]!.name,
      lines: groupLines,
      worstStatus: groupLines.reduce(
        (worst, line) =>
          severity[line.purchaseStatus] > severity[worst]
            ? line.purchaseStatus
            : worst,
        groupLines[0]!.purchaseStatus,
      ),
      deficitBranchCount: groupLines.length,
      belowMinBranchCount: groupLines.filter(
        (line) => line.purchaseStatus === 'BELOW_MIN',
      ).length,
      totalDeficitQty: groupLines.reduce(
        (sum, line) => sum + line.purchaseQty,
        0,
      ),
      totalDemandAmount: positiveLines.reduce(
        (sum, line) => sum + (line.purchaseAmount ?? 0),
        0,
      ),
      missingPriceCount: positiveLines.filter(
        (line) => line.purchaseAmount == null,
      ).length,
      selectedSupplier: groupLines[0]!.selectedSupplier,
    };
  });
}

function filterNetworkGroups(
  groups: NetworkGroup[],
  filters: DemandFilters,
  orderLineKeys: Set<string>,
): NetworkGroup[] {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  return groups.filter((group) => {
    if (
      query &&
      !`${group.skuCode} ${group.article ?? ''} ${group.name}`
        .toLocaleLowerCase('ru-RU')
        .includes(query)
    )
      return false;
    if (filters.status !== 'ALL' && group.worstStatus !== filters.status)
      return false;
    if (filters.supplier === '__UNASSIGNED__' && group.selectedSupplier)
      return false;
    if (
      filters.supplier &&
      filters.supplier !== '__UNASSIGNED__' &&
      group.selectedSupplier !== filters.supplier
    )
      return false;
    if (!passesMoney(group.totalDemandAmount, filters)) return false;
    if (
      filters.onlyInOrders &&
      !group.lines.some((line) =>
        orderLineKeys.has(`${line.skuCode}\0${line.branch}`),
      )
    )
      return false;
    if (filters.problemsOnly && !group.lines.some(hasProblem)) return false;
    return true;
  });
}

function filterBranchLines(
  lines: PurchaseDemandLine[],
  filters: DemandFilters,
  orderLineKeys: Set<string>,
  showCovered = false,
): PurchaseDemandLine[] {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  const diagnosticStatus = getDiagnosticNormStatus(filters.status);
  return lines.filter((line) => {
    if (!(
      line.purchaseQty > 0 ||
      (showCovered && line.acceptedTransferIds.length > 0) ||
      (diagnosticStatus !== null && line.purchaseStatus === diagnosticStatus)
    ))
      return false;
    if (
      query &&
      !`${line.skuCode} ${line.article ?? ''} ${line.name}`
        .toLocaleLowerCase('ru-RU')
        .includes(query)
    )
      return false;
    if (filters.status !== 'ALL' && line.purchaseStatus !== filters.status)
      return false;
    if (filters.supplier === '__UNASSIGNED__' && line.selectedSupplier)
      return false;
    if (
      filters.supplier &&
      filters.supplier !== '__UNASSIGNED__' &&
      line.selectedSupplier !== filters.supplier
    )
      return false;
    if (!passesMoney(line.purchaseAmount ?? 0, filters)) return false;
    if (
      filters.onlyInOrders &&
      !orderLineKeys.has(`${line.skuCode}\0${line.branch}`)
    )
      return false;
    if (filters.problemsOnly && !hasProblem(line)) return false;
    return true;
  });
}

function getDiagnosticNormStatus(
  status: DemandFilters['status'],
): DiagnosticNormStatus | null {
  return status === 'NO_NORM' || status === 'INVALID_NORM' ? status : null;
}

function passesMoney(amount: number, filters: DemandFilters): boolean {
  const from = filters.amountFrom === '' ? null : Number(filters.amountFrom);
  const to = filters.amountTo === '' ? null : Number(filters.amountTo);
  return (from == null || amount >= from) && (to == null || amount <= to);
}

function hasProblem(line: PurchaseDemandLine): boolean {
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
          <span>Остаток по отчёту {fmtQty(line.stock)}</span>
          <span>MIN {line.min ?? '—'}</span>
          <span>MAX {line.max ?? '—'}</span>
          <span>
            Нужно {fmtQty(line.purchaseQty)}
            <MovementIndicator
              scope={{ skuCode: line.skuCode, branch: line.branch }}
            />
          </span>
          <span>
            {line.purchaseAmount == null
              ? 'Нет цены'
              : money(line.purchaseAmount)}
          </span>
        </div>
      ))}
    </div>
  );
}

function NormAlerts({
  invalid,
  missing,
}: {
  invalid: number;
  missing: number;
}) {
  if (invalid === 0 && missing === 0) return null;
  return (
    <div className="alert-stack">
      {invalid > 0 && (
        <Alert tone="danger">
          Ошибка MIN/MAX у {invalid} строк. Они не попадут в заказ до
          исправления норматива.
        </Alert>
      )}
      {missing > 0 && (
        <Alert tone="warning">
          Нет MAX-норматива у {missing} строк. Потребность для них не
          рассчитывается.
        </Alert>
      )}
    </div>
  );
}

function Metrics({
  count,
  below,
  qty,
  sum,
  missing,
}: {
  count: number;
  below: number;
  qty: ReactNode;
  sum: number;
  missing: number;
}) {
  return (
    <div className="metrics">
      <MetricCard label="SKU ниже MAX" value={count} />
      <MetricCard label="SKU ниже MIN" value={below} />
      <MetricCard label="Нужно заказать" value={qty} />
      <MetricCard
        label="Известная сумма"
        value={money(sum)}
        note={`По текущим фильтрам${missing > 0 ? ` · Без цены: ${missing}` : ''}`}
      />
    </div>
  );
}

function Workspace({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
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

export function priceSourceLabel(
  source: PricedDemandLine['priceSource'],
): string {
  if (source === 'SUPPLIER_HISTORY') return 'История закупок';
  if (source === 'MIN_MAX_FALLBACK') return 'Цена MIN/MAX';
  return 'Нет цены';
}
