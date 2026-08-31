import { useMemo, useState } from 'react';
import { useStore } from '../../app/appStore';
import { derive } from '../../app/selectors';
import { ThresholdControls } from '../../components/ThresholdControls';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  MetricCard,
  Select,
} from '../../components/ui';
import {
  buildAutoSupplierOverrides,
  type SupplierAutoScope,
  type SupplierAutoStrategy,
} from '../../domain/supplierAutomation';
import type {
  Order,
  PricedDemandLine,
  SupplierOverride,
  SupplierResolution,
} from '../../domain/types';
import {
  saveSupplierOverride,
  saveSupplierOverrides,
} from '../../persistence/supplierOverrides';
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
  const { state, set } = useStore();
  const derived = derive(state);
  const [query, setQuery] = useState('');
  const [amountFrom, setAmountFrom] = useState('');
  const [showBelowThreshold, setShowBelowThreshold] = useState(false);
  const [decisionsOpen, setDecisionsOpen] = useState(true);
  const [selectedSkuCodes, setSelectedSkuCodes] = useState<Set<string>>(
    () => new Set(),
  );
  const [autoStrategy, setAutoStrategy] =
    useState<SupplierAutoStrategy>('MIN_PRICE');
  const [autoScope, setAutoScope] = useState<SupplierAutoScope>('ALL');
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const neededSkuCodes = useMemo(
    () =>
      new Set(
        derived.demand
          .filter((line) => line.deficitQty > 0)
          .map((line) => line.skuCode),
      ),
    [derived.demand],
  );

  const problems = derived.resolutions.filter(
    (resolution) =>
      neededSkuCodes.has(resolution.skuCode) &&
      ['MANUAL_REQUIRED', 'STALE_OVERRIDE', 'UNRESOLVED'].includes(
        resolution.status,
      ),
  );

  const operationPool = derived.resolutions.filter(
    (resolution) =>
      neededSkuCodes.has(resolution.skuCode) &&
      (problems.includes(resolution) || resolution.status === 'MANUAL_SELECTED'),
  );
  const problemSkuCodes = new Set(problems.map((problem) => problem.skuCode));
  const problemDemand = derived.demand.filter(
    (line) => problemSkuCodes.has(line.skuCode) && line.deficitQty > 0,
  );
  const problemAmount = problemDemand.some((line) => line.demandAmount == null)
    ? null
    : problemDemand.reduce((sum, line) => sum + (line.demandAmount ?? 0), 0);

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
    [operationPool, state.overrides, selectedSkuCodes, autoScope, autoStrategy, overwriteManual],
  );

  const summaries = buildSupplierSummaries(
    derived.projection.orders,
    derived.demand,
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
    const override: SupplierOverride = {
      skuCode: resolution.skuCode,
      supplier,
      source: 'MANUAL',
      updatedAt: new Date().toISOString(),
    };
    const previous = state.overrides;

    set({
      overrides: mergeOverrides(previous, [override]),
      toast: `Поставщик ${supplier} сохранён для ${resolution.skuCode}.`,
    });

    try {
      await saveSupplierOverride(override);
    } catch {
      set({
        overrides: previous,
        toast: 'Не удалось сохранить выбор поставщика.',
      });
    }
  }

  async function applyAutomation(): Promise<void> {
    if (autoOverrides.length === 0 || bulkBusy) {
      return;
    }

    const previous = state.overrides;
    setBulkBusy(true);
    set({
      overrides: mergeOverrides(previous, autoOverrides),
      toast: `Автоматически назначено: ${autoOverrides.length}.`,
    });

    try {
      await saveSupplierOverrides(autoOverrides);
      setSelectedSkuCodes(new Set());
    } catch {
      set({
        overrides: previous,
        toast: 'Не удалось сохранить массовый выбор поставщиков.',
      });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Шаг 3 из 4</p>
        <h1>Поставщики</h1>
        <p>
          Кому, на какую сумму и в какие подразделения сейчас требуется заказ.
        </p>
      </header>

      <ThresholdControls
        settings={state.settings}
        onChange={(settings) =>
          set({ settings, toast: 'Порог закупки пересчитан.' })
        }
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
          problems={problems}
          operationPool={operationPool}
          problemAmount={problemAmount}
          open={decisionsOpen}
          onOpenChange={setDecisionsOpen}
          selectedSkuCodes={selectedSkuCodes}
          onSelectedSkuCodesChange={setSelectedSkuCodes}
          strategy={autoStrategy}
          onStrategyChange={setAutoStrategy}
          scope={autoScope}
          onScopeChange={setAutoScope}
          overwriteManual={overwriteManual}
          onOverwriteManualChange={setOverwriteManual}
          previewCount={autoOverrides.length}
          bulkBusy={bulkBusy}
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
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
  problems,
  operationPool,
  problemAmount,
  open,
  onOpenChange,
  selectedSkuCodes,
  onSelectedSkuCodesChange,
  strategy,
  onStrategyChange,
  scope,
  onScopeChange,
  overwriteManual,
  onOverwriteManualChange,
  previewCount,
  bulkBusy,
  onApplyAutomation,
  onChoose,
}: {
  problems: SupplierResolution[];
  operationPool: SupplierResolution[];
  problemAmount: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSkuCodes: Set<string>;
  onSelectedSkuCodesChange: (selected: Set<string>) => void;
  strategy: SupplierAutoStrategy;
  onStrategyChange: (strategy: SupplierAutoStrategy) => void;
  scope: SupplierAutoScope;
  onScopeChange: (scope: SupplierAutoScope) => void;
  overwriteManual: boolean;
  onOverwriteManualChange: (overwrite: boolean) => void;
  previewCount: number;
  bulkBusy: boolean;
  onApplyAutomation: () => void;
  onChoose: (resolution: SupplierResolution, supplier: string) => void;
}) {
  const displayedProblems = overwriteManual ? operationPool : problems;
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
    onSelectedSkuCodesChange(
      checked
        ? new Set(displayedProblems.map((problem) => problem.skuCode))
        : new Set(),
    );
  }

  return (
    <section className="panel supplier-decisions-panel">
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
          <Alert tone="warning">
            Автовыбор использует только валидные исторические цены. Позиции без
            подходящей цены останутся на ручное решение.
          </Alert>

          <div className="supplier-auto-toolbar">
            <label>
              Стратегия автовыбора
              <Select
                aria-label="Стратегия автовыбора"
                value={strategy}
                onChange={(event) =>
                  onStrategyChange(event.target.value as SupplierAutoStrategy)
                }
              >
                <option value="MIN_PRICE">Минимальная цена</option>
              </Select>
            </label>
            <label className="checkbox-control overwrite-manual-control">
              <input
                type="checkbox"
                checked={overwriteManual}
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
              disabled={previewCount === 0 || bulkBusy}
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
                onChange={(event) => toggleAll(event.target.checked)}
              />
              Отметить все
            </label>
            <small>Отмечено: {selectedSkuCodes.size}</small>
          </div>

          <div className="decision-list">
            {displayedProblems.map((resolution) => (
              <div className="decision" key={resolution.skuCode}>
                <label className="decision-check">
                  <input
                    type="checkbox"
                    aria-label={`Выбрать ${resolution.skuCode}`}
                    checked={selectedSkuCodes.has(resolution.skuCode)}
                    onChange={(event) =>
                      toggleOne(resolution.skuCode, event.target.checked)
                    }
                  />
                </label>
                <div>
                  <strong>Код {resolution.skuCode}</strong>
                  <p>
                    {resolution.status === 'STALE_OVERRIDE'
                      ? 'Сохранённый поставщик отсутствует в свежем отчёте.'
                      : resolution.candidates.length === 0
                        ? 'Нет истории поставщиков для автоматического выбора.'
                        : 'Несколько исторических поставщиков — можно выбрать вручную или массово.'}
                  </p>
                </div>

                {resolution.candidates.length > 0 ? (
                  <Select
                    aria-label={`Поставщик ${resolution.skuCode}`}
                    value=""
                    onChange={(event) =>
                      onChoose(resolution, event.target.value)
                    }
                  >
                    <option value="">Выберите поставщика…</option>
                    {resolution.candidates.map((candidate) => (
                      <option key={candidate.supplier} value={candidate.supplier}>
                        {candidate.supplier}
                        {candidate.supplier === resolution.recommendedSupplier
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
                ) : (
                  <span className="danger-text">Только ручное уточнение</span>
                )}
              </div>
            ))}
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
      <td className="num">{fmtQty(summary.totalQty)}</td>
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
  demand: PricedDemandLine[],
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
              line.deficitQty > 0 &&
              line.status === 'BELOW_MIN',
          )
          .map((line) => line.skuCode),
      );

      return {
        supplier,
        skuCount: new Set(positiveLines.map((line) => line.skuCode)).size,
        branchCount: new Set(supplierOrders.map((order) => order.branch)).size,
        belowMinSkuCount: belowMinSku.size,
        totalQty: positiveLines.reduce(
          (sum, line) => sum + line.orderQty,
          0,
        ),
        totalAmount:
          missingPriceLineCount > 0
            ? null
            : positiveLines.reduce(
                (sum, line) => sum + (line.amount ?? 0),
                0,
              ),
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
  return order.blockers.some(
    (blocker) => blocker !== 'Ниже минимальной суммы',
  );
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
