import type { Sku } from '../../domain/types';
import type {
  AcceptedTransfer,
  RebalanceProposal,
  SkuQuantityPolicy,
  SkippedRebalanceSku,
} from '../../domain/rebalancing';
import { sumQuantities } from '../../domain/rebalancing/numbers';

export const skippedReasonLabel: Record<SkippedRebalanceSku['reason'], string> =
  {
    INSUFFICIENT_SURPLUS: 'Недостаточно излишка сверх Max',
    ROUTE_LIMIT: 'Не позволяют выбранные маршруты',
    QUANTITY_STEP: 'Потребность не закрывается целым количеством',
  };
export interface CoverageTotals {
  byUnit: { unit: string | null; skuCode?: string; qty: number }[];
  amount: number | null;
  knownAmount: number | null;
  missingPriceSkuCount: number;
  skuCount: number;
  lineCount: number;
}
export function buildFullCoverageSummary(input: {
  proposal: RebalanceProposal | null;
  accepted: AcceptedTransfer[];
  rejectedLineIds: string[];
  policies: SkuQuantityPolicy[];
  skus: Sku[];
}): { pending: CoverageTotals; skipped: CoverageTotals } {
  const prices = new Map(input.skus.map((s) => [s.code, s.referencePrice]));
  const units = new Map(input.policies.map((s) => [s.skuCode, s.unit]));
  const total = (rows: { skuCode: string; qty: number }[]): CoverageTotals => {
    const groups = new Map<
      string,
      { unit: string | null; skuCode?: string; values: number[] }
    >();
    const missing = new Set<string>();
    let amount = 0;
    for (const row of rows) {
      const unit = units.get(row.skuCode) ?? null,
        key = unit ? 'unit:' + unit : 'sku:' + row.skuCode;
      const group = groups.get(key) ?? {
        unit,
        ...(unit ? {} : { skuCode: row.skuCode }),
        values: [],
      };
      group.values.push(row.qty);
      groups.set(key, group);
      const price = prices.get(row.skuCode);
      if (
        price == null ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isFinite(price * row.qty)
      )
        missing.add(row.skuCode);
      else amount += price * row.qty;
    }
    const knownAmount = Number.isFinite(amount) ? amount : null;
    return {
      byUnit: [...groups.values()]
        .map(({ values, ...rest }) => ({ ...rest, qty: sumQuantities(values) }))
        .sort((a, b) =>
          (a.unit ?? a.skuCode ?? '').localeCompare(
            b.unit ?? b.skuCode ?? '',
            'ru',
          ),
        ),
      amount: missing.size ? null : knownAmount,
      knownAmount,
      missingPriceSkuCount: missing.size,
      skuCount: new Set(rows.map((r) => r.skuCode)).size,
      lineCount: rows.length,
    };
  };
  const accepted = new Set(
    input.accepted
      .filter((a) => a.sourceRunId === input.proposal?.runId)
      .map((a) => a.sourceLineId),
  );
  const rejected = new Set(input.rejectedLineIds);
  const pending = (input.proposal?.transfers ?? []).filter(
    (t) =>
      t.qty > 0 &&
      !accepted.has(t.sourceLineId) &&
      !rejected.has(t.sourceLineId),
  );
  return {
    pending: total(pending),
    skipped: total(
      (input.proposal?.skippedSkus ?? []).map((s) => ({
        skuCode: s.skuCode,
        qty: s.neededQty,
      })),
    ),
  };
}
