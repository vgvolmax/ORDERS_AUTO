import type {
  DemandLine,
  MinMaxDataset,
  PricedDemandLine,
  Sku,
  StockStatus,
  SupplierResolution,
} from './types';

export interface StockCalculation {
  status: StockStatus;
  deficitQty: number;
  deficitPct: number | null;
}

export function calculateStockStatus(
  stock: number,
  min: number | null,
  max: number | null,
): StockCalculation {
  if (max == null || max <= 0) {
    return { status: 'NO_NORM', deficitQty: 0, deficitPct: null };
  }

  if (min != null && min > max) {
    return { status: 'INVALID_NORM', deficitQty: 0, deficitPct: null };
  }

  const deficitQty = Math.max(0, max - stock);
  if (stock >= max) {
    return { status: 'OK', deficitQty: 0, deficitPct: 0 };
  }

  const deficitPct = deficitQty / max;

  // MIN is a hard operational threshold. It intentionally overrides the
  // softer percentage bands, even when the mathematical deficit is small.
  if (min != null && stock < min) {
    return { status: 'BELOW_MIN', deficitQty, deficitPct };
  }

  if (deficitPct <= 0.25) {
    return { status: 'YELLOW', deficitQty, deficitPct };
  }
  if (deficitPct <= 0.75) {
    return { status: 'ORANGE', deficitQty, deficitPct };
  }

  return { status: 'LIGHT_RED', deficitQty, deficitPct };
}

export function calculateDemand(dataset: MinMaxDataset): DemandLine[] {
  const skuByCode = new Map(dataset.skus.map((sku) => [sku.code, sku]));
  const base = dataset.branchStocks.map((line) => ({
    ...line,
    ...calculateStockStatus(line.stock, line.min, line.max),
  }));

  const networkDeficitBySku = new Map<string, number>();
  for (const line of base) {
    networkDeficitBySku.set(
      line.skuCode,
      (networkDeficitBySku.get(line.skuCode) ?? 0) + line.deficitQty,
    );
  }

  return base.flatMap((line) => {
    const sku = skuByCode.get(line.skuCode);
    if (!sku) {
      return [];
    }

    return [
      {
        ...line,
        article: sku.article,
        name: sku.name,
        networkDeficitQty: networkDeficitBySku.get(line.skuCode) ?? 0,
        referencePrice: sku.referencePrice,
      },
    ];
  });
}

export function priceDemand(
  lines: DemandLine[],
  skus: Sku[],
  resolutions: SupplierResolution[],
): PricedDemandLine[] {
  const skuByCode = new Map(skus.map((sku) => [sku.code, sku]));
  const resolutionByCode = new Map(
    resolutions.map((resolution) => [resolution.skuCode, resolution]),
  );

  const priced = lines.map((line): PricedDemandLine => {
    const resolution = resolutionByCode.get(line.skuCode);
    const selectedCandidate = resolution?.candidates.find(
      (candidate) => candidate.supplier === resolution.selectedSupplier,
    );
    const referencePrice = skuByCode.get(line.skuCode)?.referencePrice ?? null;

    // Price is supplier-specific when a supplier is resolved. Min-Max price is
    // only a fallback; it must never hide that the supplier price is missing.
    const unitPrice = selectedCandidate?.weightedUnitCost ?? referencePrice;
    const priceSource =
      selectedCandidate?.weightedUnitCost != null
        ? ('SUPPLIER_HISTORY' as const)
        : unitPrice != null
          ? ('MIN_MAX_FALLBACK' as const)
          : ('MISSING' as const);

    return {
      ...line,
      selectedSupplier: resolution?.selectedSupplier ?? null,
      supplierResolutionStatus: resolution?.status ?? 'UNRESOLVED',
      unit: selectedCandidate?.unit ?? null,
      unitPrice,
      priceSource,
      demandAmount: unitPrice == null ? null : line.deficitQty * unitPrice,
      networkDemandAmount: 0,
      networkMissingPriceCount: 0,
    };
  });

  const networkBySku = new Map<string, { amount: number; missing: number }>();
  for (const line of priced) {
    const current = networkBySku.get(line.skuCode) ?? { amount: 0, missing: 0 };
    if (line.deficitQty > 0) {
      if (line.demandAmount == null) {
        current.missing += 1;
      } else {
        current.amount += line.demandAmount;
      }
    }
    networkBySku.set(line.skuCode, current);
  }

  return priced.map((line) => {
    const network = networkBySku.get(line.skuCode) ?? { amount: 0, missing: 0 };
    return {
      ...line,
      networkDemandAmount: network.amount,
      networkMissingPriceCount: network.missing,
    };
  });
}
