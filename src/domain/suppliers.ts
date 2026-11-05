import type {
  SupplierHistory,
  SupplierOverride,
  SupplierResolution,
} from './types';
import { isSupplierInPool, supplierKey } from './supplierPool';

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
  const historyNameByKey = new Map(
    [...new Set(history.map((item) => item.supplier))].map((name) => [
      supplierKey(name),
      name,
    ]),
  );
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
      const poolKey =
        saved.allowWithoutHistory === true &&
        saved.source !== 'AUTO' &&
        isSupplierInPool(saved.supplier)
          ? supplierKey(saved.supplier)
          : null;
      const exactCandidate = candidates.find(
        (candidate) => candidate.supplier === saved.supplier,
      );
      let selectedSupplier = exactCandidate?.supplier ?? null;
      if (selectedSupplier == null && poolKey != null) {
        // Use the report's spelling so pricing and order grouping see the
        // same supplier name as other products already use.
        const equivalentCandidate = candidates.find(
          (candidate) => supplierKey(candidate.supplier) === poolKey,
        );
        selectedSupplier =
          equivalentCandidate?.supplier ??
          historyNameByKey.get(poolKey) ??
          saved.supplier;
      }
      return {
        skuCode,
        candidates,
        recommendedSupplier,
        selectedSupplier,
        status: selectedSupplier != null
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
