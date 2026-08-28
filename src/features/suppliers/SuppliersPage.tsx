import { useMemo, useState } from 'react';
import { derive } from '../../app/selectors';
import { useStore } from '../../app/appStore';
import { ThresholdControls } from '../../components/ThresholdControls';
import { Alert, EmptyState, Input, MetricCard, Select } from '../../components/ui';
import type {
  Order,
  PricedDemandLine,
  SupplierResolution,
} from '../../domain/types';
import { saveSupplierOverride } from '../../persistence/supplierOverrides';
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
    const override = {
      skuCode: resolution.skuCode,
      supplier,
      updatedAt: new Date().toISOString(),
    };
    const previous = state.overrides;

    set({
      overrides: [
        ...previous.filter((item) => item.skuCode !== resolution.skuCode),
        override,
      ],
      toast: `Поставщик ${supplier} сохранён для ${resolution.skuCode}.`,
    });

    try {
      await saveSupplierOverride(override);
    } catch {
      // Optimistic UI is rolled back if IndexedDB cannot persist the decision.
      // Otherwise a later reload would silently lose a supplier selection.
      set({
        overrides: previous,
        toast: 'Не удалось сохранить выбор поставщика.',
      });
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
        <SupplierDecisions problems={problems} onChoose={choose} />
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
  onChoose,
}: {
  problems: SupplierResolution[];
  onChoose: (resolution: SupplierResolution, supplier: string) => void;
}) {
  const withCandidates = problems.filter(
    (problem) => problem.candidates.length > 0,
  );
  const withoutCandidates = problems.filter(
    (problem) => problem.candidates.length === 0,
  );

  return (
    <section className="panel">
      <h2>Требуют решения</h2>
      <Alert tone="warning">
        Эти позиции не попадут ни в один заказ, пока поставщик не будет
        разрешён.
      </Alert>

      {withCandidates.map((resolution) => (
        <div className="decision" key={resolution.skuCode}>
          <div>
            <strong>Код {resolution.skuCode}</strong>
            <p>
              {resolution.status === 'STALE_OVERRIDE'
                ? 'Сохранённый поставщик отсутствует в свежем отчёте.'
                : 'Несколько исторических поставщиков — нужен ваш выбор.'}
            </p>
          </div>

          <Select
            aria-label={`Поставщик ${resolution.skuCode}`}
            value=""
            onChange={(event) => onChoose(resolution, event.target.value)}
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
        </div>
      ))}

      {withoutCandidates.length > 0 && (
        <div className="no-supplier-block">
          <strong>
            Нет истории поставщиков: {withoutCandidates.length} SKU
          </strong>
          <div className="code-list">
            {withoutCandidates.slice(0, 20).map((item) => (
              <span key={item.skuCode}>{item.skuCode}</span>
            ))}
          </div>
          {withoutCandidates.length > 20 && (
            <small>И ещё {withoutCandidates.length - 20}</small>
          )}
        </div>
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
        // Never present a partial supplier amount as if it were complete.
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
