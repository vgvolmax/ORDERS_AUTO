import type {
  DemandLine,
  MinMaxDataset,
  PricedDemandLine,
  Sku,
  StockStatus,
  SupplierResolution,
} from './types';
import { normalizeKey } from './normalize';
import { moneyProduct, moneySum } from './money';
import { addDecimal, decimal, decimalNumber } from './decimal';
import { hasNegativeStockNorm } from './stockNorms';

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
  if (hasNegativeStockNorm(min, max)) {
    return { status: 'INVALID_NORM', deficitQty: 0, deficitPct: null };
  }
  if (max == null || max <= 0) {
    return { status: 'NO_NORM', deficitQty: 0, deficitPct: null };
  }

  if (min != null && min > max) {
    return { status: 'INVALID_NORM', deficitQty: 0, deficitPct: null };
  }

  if (stock >= max) {
    return { status: 'OK', deficitQty: 0, deficitPct: 0 };
  }

  const exactMax = decimal(max);
  const exactStock = decimal(stock);
  const exactDeficit = addDecimal(exactMax, { n: -exactStock.n, d: exactStock.d });
  const deficitQty = decimalNumber(exactDeficit);
  const deficitPct = deficitQty / max;

  // MIN is a hard operational threshold. It intentionally overrides the
  // softer percentage bands, even when the mathematical deficit is small.
  if (min != null && stock < min) {
    return { status: 'BELOW_MIN', deficitQty, deficitPct };
  }

  // Compare the underlying decimal values before the displayed ratio is rounded.
  const deficitQuarters = 4n * exactDeficit.n * exactMax.d;
  const scaledMax = exactMax.n * exactDeficit.d;
  if (deficitQuarters <= scaledMax) {
    return { status: 'YELLOW', deficitQty, deficitPct };
  }
  if (deficitQuarters <= 3n * scaledMax) {
    return { status: 'ORANGE', deficitQty, deficitPct };
  }

  return { status: 'LIGHT_RED', deficitQty, deficitPct };
}

export function calculateDemand(dataset: MinMaxDataset): DemandLine[] {
  const skuByCode = new Map(dataset.skus.map((sku) => [sku.code, sku]));
  // Retain one provisional row for inspection. Purchasing source diagnostics
  // separately hard-block ambiguous slices, including old normalized sessions.
  const seen = new Set<string>();
  const base = dataset.branchStocks
    .filter((line) => {
      const key = JSON.stringify([line.skuCode, normalizeKey(line.branch)]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((line) => ({
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
  return priceDemandWithSource(lines, skus, resolutions, true);
}

export function priceDemandFromMinMax(
  lines: DemandLine[],
  skus: Sku[],
  resolutions: SupplierResolution[],
): PricedDemandLine[] {
  return priceDemandWithSource(lines, skus, resolutions, false);
}

function priceDemandWithSource(
  lines: DemandLine[],
  skus: Sku[],
  resolutions: SupplierResolution[],
  useHistoricalPrices: boolean,
): PricedDemandLine[] {
  const skuByCode = new Map(skus.map((sku) => [sku.code, sku]));
  const duplicateCodes = new Set<string>();
  const codes = new Set<string>();
  for (const sku of skus) {
    if (codes.has(sku.code)) duplicateCodes.add(sku.code);
    codes.add(sku.code);
  }
  const validPrice = (price: number | null | undefined): number | null =>
    price != null && Number.isFinite(price) && price >= 0 ? price : null;
  const resolutionByCode = new Map(
    resolutions.map((resolution) => [resolution.skuCode, resolution]),
  );

  const referenceSource = useHistoricalPrices ? 'MIN_MAX_FALLBACK' : 'MIN_MAX';
  const priced = lines.map((line): PricedDemandLine => {
    const resolution = resolutionByCode.get(line.skuCode);
    const selectedCandidate = resolution?.candidates.find(
      (candidate) => candidate.supplier === resolution.selectedSupplier,
    );
    const referencePrice = duplicateCodes.has(line.skuCode)
      ? null
      : validPrice(skuByCode.get(line.skuCode)?.referencePrice);

    const supplierPrice = useHistoricalPrices
      ? validPrice(selectedCandidate?.weightedUnitCost)
      : null;
    const unitPrice = supplierPrice ?? referencePrice;
    const priceSource =
      supplierPrice != null
        ? ('SUPPLIER_HISTORY' as const)
        : unitPrice != null
          ? referenceSource
          : ('MISSING' as const);

    return {
      ...line,
      selectedSupplier: resolution?.selectedSupplier ?? null,
      supplierResolutionStatus: resolution?.status ?? 'UNRESOLVED',
      unit: selectedCandidate?.unit ?? null,
      unitPrice,
      priceSource,
      demandAmount:
        unitPrice == null ? null : moneyProduct(line.deficitQty, unitPrice),
      networkDemandAmount: 0,
      networkMissingPriceCount: 0,
    };
  });

  const networkBySku = new Map<
    string,
    { amounts: number[]; missing: number }
  >();
  for (const line of priced) {
    const current = networkBySku.get(line.skuCode) ?? {
      amounts: [],
      missing: 0,
    };
    if (line.deficitQty > 0) {
      if (line.demandAmount == null) {
        current.missing += 1;
      } else {
        current.amounts.push(line.demandAmount);
      }
    }
    networkBySku.set(line.skuCode, current);
  }

  return priced.map((line) => {
    const network = networkBySku.get(line.skuCode)!;
    return {
      ...line,
      networkDemandAmount: moneySum(network.amounts),
      networkMissingPriceCount: network.missing,
    };
  });
}
