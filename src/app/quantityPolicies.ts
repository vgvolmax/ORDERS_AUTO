import type { AppState } from './appStore';
import { normalizeKey, normalizeText } from '../domain/normalize';
import type {
  SkuQuantityPolicy,
  RebalanceIssue,
  RebalanceTransfer,
} from '../domain/rebalancing';

export function hasIncompatibleTransferQuantities(
  transfers: RebalanceTransfer[],
  issues: RebalanceIssue[],
): boolean {
  const legacy = new Set(
    issues
      .filter((i) => i.code === 'LEGACY_QUANTITY_POLICY')
      .map((i) => i.skuCode),
  );
  return transfers.some(
    (t) => !Number.isInteger(t.qty) || legacy.has(t.skuCode),
  );
}

/** App transfers always use whole units. Saved policy data is read-only history. */
export function resolveQuantityPolicies(state: AppState): SkuQuantityPolicy[] {
  const units = new Map<string, Map<string, string>>();
  const mixedUnits = new Set(
    state.supplierIssues
      .filter((i) => i.code === 'MIXED_UNITS')
      .map((i) => i.skuCode),
  );
  const validUnit = (value: string | null | undefined) => {
    const unit = normalizeText(value);
    return unit && !Number.isFinite(Number(unit.replace(',', '.')))
      ? unit
      : null;
  };
  for (const row of state.suppliers?.history ?? []) {
    const unit = validUnit(row.unit);
    if (!unit) continue;
    const values = units.get(row.skuCode) ?? new Map<string, string>();
    values.set(normalizeKey(unit), unit);
    units.set(row.skuCode, values);
  }
  const saved = new Map(state.rebalance.policies.map((p) => [p.skuCode, p]));
  const fractional = new Set(
    state.rebalance.accepted
      .filter((t) => !Number.isInteger(t.qty))
      .map((t) => t.skuCode),
  );
  return (state.minMax?.skus ?? []).map((sku) => {
    const old = saved.get(sku.code),
      candidates = units.get(sku.code);
    const legacyStep =
      fractional.has(sku.code) && old && old.quantityStep > 0
        ? old.quantityStep
        : 1;
    return {
      skuCode: sku.code,
      unit: mixedUnits.has(sku.code)
        ? 'ед.'
        : candidates?.size === 1
          ? [...candidates.values()][0]!
          : candidates?.size
            ? 'ед.'
            : (validUnit(old?.unit) ?? 'ед.'),
      quantityStep: legacyStep,
    };
  });
}
