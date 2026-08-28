import type {
  SupplierHistory,
  SupplierOverride,
  SupplierResolution,
} from './types';

export type SupplierAutoStrategy = 'MIN_PRICE';
export type SupplierAutoScope = 'ALL' | 'SELECTED' | 'EXCEPT_SELECTED';

interface BuildAutoSupplierOverridesInput {
  resolutions: SupplierResolution[];
  currentOverrides: SupplierOverride[];
  selectedSkuCodes: Iterable<string>;
  scope: SupplierAutoScope;
  strategy: SupplierAutoStrategy;
  overwriteManual: boolean;
  now?: string;
}

export function selectSupplierCandidate(
  resolution: SupplierResolution,
  strategy: SupplierAutoStrategy,
): SupplierHistory | null {
  if (strategy !== 'MIN_PRICE') {
    return null;
  }

  const valid = resolution.candidates
    .filter(
      (candidate) =>
        candidate.weightedUnitCost != null &&
        Number.isFinite(candidate.weightedUnitCost) &&
        candidate.weightedUnitCost > 0,
    )
    .sort(
      (left, right) =>
        left.weightedUnitCost! - right.weightedUnitCost! ||
        right.purchaseQty - left.purchaseQty ||
        right.purchaseAmount - left.purchaseAmount ||
        left.supplier.localeCompare(right.supplier, 'ru'),
    );

  return valid[0] ?? null;
}

export function buildAutoSupplierOverrides({
  resolutions,
  currentOverrides,
  selectedSkuCodes,
  scope,
  strategy,
  overwriteManual,
  now = new Date().toISOString(),
}: BuildAutoSupplierOverridesInput): SupplierOverride[] {
  const selected = new Set(selectedSkuCodes);
  const overrideBySku = new Map(
    currentOverrides.map((override) => [override.skuCode, override]),
  );

  return resolutions.flatMap((resolution) => {
    if (!isInScope(resolution.skuCode, selected, scope)) {
      return [];
    }

    const existing = overrideBySku.get(resolution.skuCode);
    const activeManualSelection =
      resolution.status === 'MANUAL_SELECTED' &&
      existing != null &&
      existing.source !== 'AUTO';
    if (activeManualSelection && !overwriteManual) {
      return [];
    }

    const chosen = selectSupplierCandidate(resolution, strategy);
    if (!chosen) {
      return [];
    }

    return [
      {
        skuCode: resolution.skuCode,
        supplier: chosen.supplier,
        source: 'AUTO' as const,
        updatedAt: now,
      },
    ];
  });
}

function isInScope(
  skuCode: string,
  selected: Set<string>,
  scope: SupplierAutoScope,
): boolean {
  if (scope === 'ALL') {
    return true;
  }
  if (scope === 'SELECTED') {
    return selected.has(skuCode);
  }
  return !selected.has(skuCode);
}
