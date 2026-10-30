import { VirtualTable } from '../../components/VirtualTable';
import { productColumns } from '../../components/productColumns';
import { QuantitySummary } from '../../components/QuantitySummary';
import type { Sku } from '../../domain/types';
import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { useDerivedState } from '../../app/useDerivedState';
import { usePreference } from '../../app/usePreference';
import { derive } from '../../app/selectors';
import type { PurchaseDemandLine } from '../../domain/purchaseDemand';
import { SUPPLIER_POOL } from '../../domain/supplierPool';
import { ThresholdControls } from '../../components/ThresholdControls';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  MetricCard,
  Select,
  SearchInput,
} from '../../components/ui';
import {
  buildAutoSupplierOverrides,
  getSupplierDecisionPool,
  type SupplierAutoScope,
  type SupplierAutoStrategy,
} from '../../domain/supplierAutomation';
import type {
  Order,
  SupplierOverride,
  SupplierResolution,
} from '../../domain/types';
import { fmtQty, money } from '../demand/DemandPage';

interface SupplierSummary {
  supplier: string;
  skuCount: number;
  branchCount: number;
  belowMinSkuCount: number;
  totalQty: number;
  totalAmount: number | null;
  missingPriceLineCount: number;
  belowThresholdOrderCount: number;
  orderCount: number;
  orders: Order[];
}

export function SuppliersPage() {
  const { state, set, commit } = useStore();
  const derived = useDerivedState(state);
  const [query, setQuery] = usePreference('suppliers:query', '');
  const [amountFrom, setAmountFrom] = usePreference('suppliers:amountFrom', '');
  const [showBelowThreshold, setShowBelowThreshold] = usePreference(
    'suppliers:belowThreshold',
    false,
  );
  const [decisionsOpen, setDecisionsOpen] = usePreference(
    'suppliers:decisionsOpen',
    true,
  );
  const [selectedCodes, setSelectedCodes] = usePreference<string[]>(
    'suppliers:selectedCodes',
    [],
  );
  const selectedSkuCodes = useMemo(
    () => new Set(selectedCodes),
    [selectedCodes],
  );
  const setSelectedSkuCodes = (codes: Set<string>) =>
    setSelectedCodes([...codes]);
  const [autoStrategy] = usePreference<SupplierAutoStrategy>(
    'suppliers:autoStrategy',
    'MIN_PRICE',
  );
  const [autoScope, setAutoScope] = usePreference<SupplierAutoScope>(
    'suppliers:autoScope',
    'ALL',
  );
  const [overwriteManual, setOverwriteManual] = usePreference(
    'suppliers:overwriteManual',
    false,
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const [manualBusyCode, setManualBusyCode] = useState<string | null>(null);
  const supplierOperation = useRef(false);

  const operationPool = getSupplierDecisionPool(
    derived.resolutions,
    derived.purchaseDemand,
  );
  const problems = operationPool.filter(
    (resolution) => resolution.status !== 'MANUAL_SELECTED',
  );
  const problemSkuCodes = new Set(problems.map((problem) => problem.skuCode));
  const problemDemand = derived.purchaseDemand.filter(
    (line) => problemSkuCodes.has(line.skuCode) && line.purchaseQty > 0,
  );
  const problemAmount = problemDemand.some(
    (line) => line.purchaseAmount == null,
  )
    ? null
    : problemDemand.reduce((sum, line) => sum + (line.purchaseAmount ?? 0), 0);

  const autoOverrides = useMemo(
    () =>
      buildAutoSupplierOverrides({
        resolutions: operationPool,
        currentOverrides: state.overrides,
        selectedSkuCodes,
        scope: autoScope,
        strategy: autoStrategy,
        overwriteManual,
      }),
    [
      operationPool,
      state.overrides,
      selectedSkuCodes,
      autoScope,
      autoStrategy,
      overwriteManual,
    ],
  );

  const summaries = buildSupplierSummaries(
    derived.projection.orders,
    derived.purchaseDemand,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const minimumAmount = amountFrom === '' ? null : Number(amountFrom);

  const visibleSummaries = summaries.filter((summary) => {
    if (
      normalizedQuery &&
      !summary.supplier.toLocaleLowerCase('ru-RU').includes(normalizedQuery)
    ) {
      return false;
    }

    if (
      minimumAmount != null &&
      (summary.totalAmount == null || summary.totalAmount < minimumAmount)
    ) {
      return false;
    }

    const hasNonThresholdOrder = summary.orders.some(
      (order) => !order.belowThreshold || hasHardBlocker(order),
    );
    if (!showBelowThreshold && !hasNonThresholdOrder) {
      return false;
    }

    return true;
  });

  async function choose(
    resolution: SupplierResolution,
    supplier: string,
  ): Promise<void> {
    if (supplierOperation.current) return;
    supplierOperation.current = true;
    setManualBusyCode(resolution.skuCode);
    const override: SupplierOverride = {
      skuCode: resolution.skuCode,
      supplier,
      source: 'MANUAL',
      updatedAt: new Date().toISOString(),
    };
    try {
      const patch = (s: typeof state) => ({
        overrides: mergeOverrides(s.overrides, [override]),
        toast: `Поставщик ${supplier} сохранён для ${resolution.skuCode}.`,
      });
      if (commit) await commit(patch);
      else set(patch(state));
    } catch {
      set({
        toast:
          'Не удалось сохранить выбор поставщика. Предыдущий выбор сохранён.',
      });
    } finally {
      supplierOperation.current = false;
      setManualBusyCode(null);
    }
  }

  async function applyAutomation(): Promise<void> {
    if (!autoOverrides.length || supplierOperation.current) return;
    supplierOperation.current = true;
    setBulkBusy(true);
    try {
      const patch = (s: typeof state) => {
        // Earlier queued writes may have changed manual choices, prices or demand.
        // The preview is advisory; permission to overwrite is checked at commit.
        const current = derive(s);
        const fresh = buildAutoSupplierOverrides({
          resolutions: getSupplierDecisionPool(
            current.resolutions,
            current.purchaseDemand,
          ),
          currentOverrides: s.overrides,
          selectedSkuCodes,
          scope: autoScope,
          strategy: autoStrategy,
          overwriteManual,
        });
        return fresh.length
          ? {
              overrides: mergeOverrides(s.overrides, fresh),
              toast: `Автоматически назначено: ${fresh.length}.`,
            }
          : { toast: 'Подходящих позиций для автовыбора не осталось.' };
      };
      if (commit) await commit(patch);
      else set(patch(state));
      setSelectedSkuCodes(new Set());
    } catch {
      set({
        toast:
          'Не удалось сохранить массовый выбор поставщиков. Повторите действие.',
      });
    } finally {
      supplierOperation.current = false;
      setBulkBusy(false);
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Рабочая потребность</p>
        <h1>Поставщики</h1>
        <p>
          Кому, на какую сумму и в какие подразделения сейчас требуется заказ.
        </p>
        <p className="supplier-pool-note">
          Рабочий пул: {SUPPLIER_POOL.length} поставщика. Остальные скрыты из
          выбора и заказов; исходная история закупок сохранена.
        </p>
      </header>

      <ThresholdControls
        settings={state.settings}
        onChange={async (settings) => {
          const patch = { settings };
          if (commit) await commit(patch);
          else set(patch);
        }}
        showBelowThreshold={showBelowThreshold}
        onShowBelowThresholdChange={setShowBelowThreshold}
      />

      <div className="metrics metrics-three">
        <MetricCard
          label="Поставщиков с потребностью"
          value={summaries.length}
        />
        <MetricCard label="Требуют выбора" value={problems.length} />
        <MetricCard
          label="Нераспределённых строк"
          value={derived.projection.unassigned.length}
        />
      </div>

      {problems.length > 0 && (
        <SupplierDecisions
          skus={state.minMax?.skus ?? []}
          problems={problems}
          operationPool={operationPool}
          problemAmount={problemAmount}
          open={decisionsOpen}
          onOpenChange={setDecisionsOpen}
          selectedSkuCodes={selectedSkuCodes}
          onSelectedSkuCodesChange={setSelectedSkuCodes}
          scope={autoScope}
          onScopeChange={setAutoScope}
          overwriteManual={overwriteManual}
          onOverwriteManualChange={setOverwriteManual}
          previewCount={autoOverrides.length}
          bulkBusy={bulkBusy}
          manualBusyCode={manualBusyCode}
          onApplyAutomation={applyAutomation}
          onChoose={choose}
        />
      )}

      <section
        className="filters compact-filters"
        aria-label="Фильтры поставщиков"
      >
        <label>
          Поиск поставщика
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Название поставщика"
          />
        </label>
        <label>
          Потребность от, ₽
          <Input
            type="number"
            min="0"
            value={amountFrom}
            onChange={(event) => setAmountFrom(event.target.value)}
          />
        </label>
        <span>
          Найдено: <strong>{visibleSummaries.length}</strong>
        </span>
        {(query || amountFrom) && (
          <button
            className="link"
            onClick={() => {
              setQuery('');
              setAmountFrom('');
            }}
          >
            Сбросить фильтры
          </button>
        )}
      </section>

      {visibleSummaries.length > 0 ? (
        <section className="panel supplier-table-panel">
          <div className="section-heading">
            <div>
              <h2>Потребность по поставщикам</h2>
              <p>
                Сумма помечается неизвестной, если хотя бы у одной позиции нет
                цены.
              </p>
            </div>
          </div>

          <div className="table-wrap supplier-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th className="num">SKU</th>
                  <th className="num">Подразделений</th>
                  <th className="num">SKU ниже MIN</th>
                  <th className="num">Количество</th>
                  <th className="num">Сумма</th>
                  <th>Статус порога</th>
                </tr>
              </thead>
              <tbody>
                {visibleSummaries.map((summary) => (
                  <SupplierRow key={summary.supplier} summary={summary} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyState>
          Нет поставщиков, соответствующих текущему порогу и фильтрам.
        </EmptyState>
      )}
    </main>
  );
}

function SupplierDecisions({
  skus,
  problems,
  operationPool,
  problemAmount,
  open,
  onOpenChange,
  selectedSkuCodes,
  onSelectedSkuCodesChange,
  scope,
  onScopeChange,
  overwriteManual,
  onOverwriteManualChange,
  previewCount,
  bulkBusy,
  manualBusyCode,
  onApplyAutomation,
  onChoose,
}: {
  skus: Sku[];
  problems: SupplierResolution[];
  operationPool: SupplierResolution[];
  problemAmount: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSkuCodes: Set<string>;
  onSelectedSkuCodesChange: (selected: Set<string>) => void;
  scope: SupplierAutoScope;
  onScopeChange: (scope: SupplierAutoScope) => void;
  overwriteManual: boolean;
  onOverwriteManualChange: (overwrite: boolean) => void;
  previewCount: number;
  bulkBusy: boolean;
  manualBusyCode: string | null;
  onApplyAutomation: () => void;
  onChoose: (resolution: SupplierResolution, supplier: string) => void;
}) {
  const supplierBusy = bulkBusy || manualBusyCode !== null;
  const [productQuery, setProductQuery] = useState('');
  const skuMap = new Map(skus.map((s) => [s.code, s]));
  const displayedProblems = (overwriteManual ? operationPool : problems).filter(
    (r) =>
      [
        r.skuCode,
        skuMap.get(r.skuCode)?.article ?? '',
        skuMap.get(r.skuCode)?.name ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(productQuery.trim().toLocaleLowerCase('ru')),
  );
  const allSelected =
    displayedProblems.length > 0 &&
    displayedProblems.every((problem) => selectedSkuCodes.has(problem.skuCode));

  function toggleOne(skuCode: string, checked: boolean): void {
    const next = new Set(selectedSkuCodes);
    if (checked) {
      next.add(skuCode);
    } else {
      next.delete(skuCode);
    }
    onSelectedSkuCodesChange(next);
  }

  function toggleAll(checked: boolean): void {
    const next = new Set(selectedSkuCodes);
    for (const problem of displayedProblems)
      if (checked) next.add(problem.skuCode);
      else next.delete(problem.skuCode);
    onSelectedSkuCodesChange(next);
  }

  return (
    <section
      className="panel supplier-decisions-panel"
      aria-busy={supplierBusy}
    >
      <div className="decision-panel-head">
        <div>
          <h2>
            Требуют решения · {problems.length} позиций ·{' '}
            {problemAmount == null ? 'сумма неизвестна' : money(problemAmount)}
          </h2>
          <p>
            Эти позиции не попадут ни в один заказ, пока поставщик не будет
            разрешён.
          </p>
        </div>
        <button
          className="link decision-collapse"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          {open ? 'Свернуть «Требуют решения»' : 'Развернуть «Требуют решения»'}
        </button>
      </div>

      {open && (
        <>
          <p className="supplier-auto-note">
            Автовыбор использует только валидные исторические цены. Позиции без
            подходящей цены останутся на ручное решение.
          </p>

          <div className="supplier-auto-toolbar">
            <div className="supplier-auto-strategy"><span>Автовыбор</span><strong>Минимальная цена</strong></div>
            <label className="checkbox-control overwrite-manual-control">
              <input
                type="checkbox"
                checked={overwriteManual}
                disabled={supplierBusy}
                onChange={(event) =>
                  onOverwriteManualChange(event.target.checked)
                }
              />
              Перезаписать ручные назначения
            </label>
            <label>
              Область применения
              <Select
                aria-label="Область применения"
                value={scope}
                disabled={supplierBusy}
                onChange={(event) =>
                  onScopeChange(event.target.value as SupplierAutoScope)
                }
              >
                <option value="ALL">Все позиции</option>
                <option value="SELECTED">Только отмеченные</option>
                <option value="EXCEPT_SELECTED">Все кроме отмеченных</option>
              </Select>
            </label>
            <div className="auto-preview" role="status">
              Будет назначено: <strong>{previewCount}</strong>
            </div>
            <Button
              disabled={previewCount === 0 || supplierBusy}
              onClick={onApplyAutomation}
            >
              {bulkBusy ? 'Сохраняем…' : 'Применить автовыбор'}
            </Button>
          </div>

          <div className="decision-select-all">
            <label className="checkbox-control">
              <input
                type="checkbox"
                aria-label="Выбрать все позиции"
                checked={allSelected}
                disabled={supplierBusy || !displayedProblems.length}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              Отметить все по поиску
            </label>
            <small>Отмечено: {selectedSkuCodes.size}</small>
            <small>По поиску: {displayedProblems.length}</small>
          </div>

          <label>
            Поиск товара
            <SearchInput
              aria-label="Поиск товара для выбора поставщика"
              value={productQuery}
              onValueChange={setProductQuery}
            />
          </label>
          <div className="decision-list">
            <VirtualTable
              rows={displayedProblems}
              getRowKey={(r) => r.skuCode}
              rowClassName="decision"
              columns={[
                {
                  key: 'check',
                  header: '',
                  width: '36px',
                  render: (resolution) => (
                    <label className="decision-check">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${resolution.skuCode}`}
                        checked={selectedSkuCodes.has(resolution.skuCode)}
                        disabled={supplierBusy}
                        onChange={(e) =>
                          toggleOne(resolution.skuCode, e.target.checked)
                        }
                      />
                    </label>
                  ),
                },
                ...productColumns<SupplierResolution>(
                  (r) => ({
                    code: r.skuCode,
                    article: skuMap.get(r.skuCode)?.article ?? null,
                    name: skuMap.get(r.skuCode)?.name ?? r.skuCode,
                  }),
                  {
                    code: { width: '130px' },
                    article: { width: '110px' },
                    name: {
                      width: 'minmax(200px,1fr)',
                      render: (resolution) => (
                        <>
                          <strong>
                            {skuMap.get(resolution.skuCode)?.name ??
                              resolution.skuCode}
                          </strong>
                          <p>
                            {resolution.status === 'STALE_OVERRIDE'
                              ? 'Сохранённый поставщик отсутствует в свежем отчёте или не входит в рабочий пул.'
                              : resolution.candidates.length === 0
                                ? 'В рабочем пуле нет истории поставщиков для этой позиции.'
                                : 'Несколько исторических поставщиков — можно выбрать вручную или массово.'}
                          </p>
                        </>
                      ),
                    },
                  },
                ),
                {
                  key: 'supplier',
                  header: 'Поставщик',
                  width: 'minmax(280px,1.3fr)',
                  render: (resolution) =>
                    resolution.candidates.length > 0 ? (
                      <div className="decision-supplier">
                        <Select
                          aria-label={`Поставщик ${resolution.skuCode}`}
                          value=""
                          disabled={supplierBusy}
                          onChange={(event) =>
                            onChoose(resolution, event.target.value)
                          }
                        >
                          <option value="">Выберите поставщика…</option>
                          {resolution.candidates.map((candidate) => (
                            <option
                              key={candidate.supplier}
                              value={candidate.supplier}
                            >
                              {candidate.supplier}
                              {candidate.supplier ===
                              resolution.recommendedSupplier
                                ? ' — рекомендуемый'
                                : ''}
                              {' · '}
                              {fmtQty(candidate.purchaseQty)} ед. ·{' '}
                              {money(candidate.purchaseAmount)} ·{' '}
                              {candidate.weightedUnitCost == null
                                ? 'нет цены'
                                : money(candidate.weightedUnitCost)}
                            </option>
                          ))}
                        </Select>
                        {manualBusyCode === resolution.skuCode && (
                          <small role="status">Сохраняем выбор…</small>
                        )}
                      </div>
                    ) : (
                      <span className="danger-text">
                        Только ручное уточнение
                      </span>
                    ),
                },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}

function SupplierRow({ summary }: { summary: SupplierSummary }) {
  return (
    <tr>
      <td>
        <details>
          <summary>
            <strong>{summary.supplier}</strong>
          </summary>
          <div className="supplier-details">
            {summary.orders.map((order) => (
              <div key={order.id}>
                <strong>{order.branch}</strong> ·{' '}
                {order.lines.filter((line) => line.orderQty > 0).length} SKU ·{' '}
                {order.totalAmount == null
                  ? 'Сумма неизвестна'
                  : money(order.totalAmount)}
              </div>
            ))}
          </div>
        </details>
      </td>
      <td className="num">{summary.skuCount}</td>
      <td className="num">{summary.branchCount}</td>
      <td className="num">{summary.belowMinSkuCount}</td>
      <td className="num"><QuantitySummary rows={summary.orders.flatMap(order => order.lines.map(line => ({ skuCode: line.skuCode, qty: line.orderQty, unit: line.unit })))} /></td>
      <td className="num">
        {summary.totalAmount == null ? (
          <span className="danger-text">
            Сумма неизвестна
            <small>Без цены: {summary.missingPriceLineCount}</small>
          </span>
        ) : (
          money(summary.totalAmount)
        )}
      </td>
      <td>
        {summary.belowThresholdOrderCount > 0 ? (
          <span className="threshold-warning">
            Ниже порога: {summary.belowThresholdOrderCount}/{summary.orderCount}
          </span>
        ) : (
          <span className="success">Порог пройден</span>
        )}
      </td>
    </tr>
  );
}

function buildSupplierSummaries(
  orders: Order[],
  demand: PurchaseDemandLine[],
): SupplierSummary[] {
  const suppliers = [...new Set(orders.map((order) => order.supplier))];

  return suppliers
    .map((supplier) => {
      const supplierOrders = orders.filter(
        (order) => order.supplier === supplier,
      );
      const positiveLines = supplierOrders.flatMap((order) =>
        order.lines.filter((line) => line.orderQty > 0),
      );
      const missingPriceLineCount = positiveLines.filter(
        (line) => line.amount == null,
      ).length;
      const belowMinSku = new Set(
        demand
          .filter(
            (line) =>
              line.selectedSupplier === supplier &&
              line.purchaseQty > 0 &&
              line.purchaseStatus === 'BELOW_MIN',
          )
          .map((line) => line.skuCode),
      );

      return {
        supplier,
        skuCount: new Set(positiveLines.map((line) => line.skuCode)).size,
        branchCount: new Set(supplierOrders.map((order) => order.branch)).size,
        belowMinSkuCount: belowMinSku.size,
        totalQty: positiveLines.reduce((sum, line) => sum + line.orderQty, 0),
        totalAmount:
          missingPriceLineCount > 0
            ? null
            : positiveLines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
        missingPriceLineCount,
        belowThresholdOrderCount: supplierOrders.filter(
          (order) => order.belowThreshold,
        ).length,
        orderCount: supplierOrders.length,
        orders: supplierOrders,
      };
    })
    .sort(
      (left, right) =>
        right.totalQty - left.totalQty ||
        left.supplier.localeCompare(right.supplier, 'ru'),
    );
}

function hasHardBlocker(order: Order) {
  return order.blockers.some((blocker) => blocker !== 'Ниже минимальной суммы');
}

function mergeOverrides(
  current: SupplierOverride[],
  replacements: SupplierOverride[],
): SupplierOverride[] {
  const replacementCodes = new Set(replacements.map((item) => item.skuCode));
  return [
    ...current.filter((item) => !replacementCodes.has(item.skuCode)),
    ...replacements,
  ];
}
