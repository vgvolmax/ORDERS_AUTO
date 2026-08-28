import type {
  SupplierHistory,
  SupplierOverride,
  SupplierResolution,
} from './types';

export function resolveSuppliers(
  history: SupplierHistory[],
  overrides: SupplierOverride[],
  skuCodes: string[] = [],
): SupplierResolution[] {
  const candidatesBySku = new Map<string, SupplierHistory[]>();
  for (const item of history) {
    const candidates = candidatesBySku.get(item.skuCode) ?? [];
    candidates.push(item);
    candidatesBySku.set(item.skuCode, candidates);
  }

  const overrideBySku = new Map(overrides.map((item) => [item.skuCode, item]));
  const allCodes = new Set([
    ...skuCodes,
    ...candidatesBySku.keys(),
    ...overrideBySku.keys(),
  ]);

  return [...allCodes].map((skuCode): SupplierResolution => {
    const candidates = [...(candidatesBySku.get(skuCode) ?? [])].sort(
      (left, right) =>
        right.purchaseQty - left.purchaseQty ||
        right.purchaseAmount - left.purchaseAmount ||
        left.supplier.localeCompare(right.supplier, 'ru'),
    );
    const recommendedSupplier = candidates[0]?.supplier ?? null;
    const saved = overrideBySku.get(skuCode);

    if (saved) {
      const stillExists = candidates.some(
        (candidate) => candidate.supplier === saved.supplier,
      );
      return {
        skuCode,
        candidates,
        recommendedSupplier,
        selectedSupplier: stillExists ? saved.supplier : null,
        status: stillExists
          ? saved.source === 'AUTO'
            ? 'AUTO_SELECTED'
            : 'MANUAL_SELECTED'
          : 'STALE_OVERRIDE',
      };
    }

    if (candidates.length === 1) {
      return {
        skuCode,
        candidates,
        recommendedSupplier,
        selectedSupplier: candidates[0]!.supplier,
        status: 'AUTO_SINGLE',
      };
    }

    // Multiple historical suppliers are deliberately not auto-selected. The
    // recommendation is advisory; the purchasing user owns the decision.
    return {
      skuCode,
      candidates,
      recommendedSupplier,
      selectedSupplier: null,
      status: candidates.length > 1 ? 'MANUAL_REQUIRED' : 'UNRESOLVED',
    };
  });
}
