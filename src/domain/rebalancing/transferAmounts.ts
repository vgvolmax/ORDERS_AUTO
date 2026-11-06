import { moneyProduct, moneySum } from '../money';
import { decimal, multiplyDecimal } from '../decimal';
import { integerWeights } from './numbers';
import {
  stockKey,
  type RebalanceConfig,
  type RebalanceSnapshot,
  type RebalanceTransfer,
} from './types';

/** Live legacy settings retain their enabled/value; historical accepted configs are not migrated. */
export function getTransferAmountFilter(config: RebalanceConfig) {
  return config.transferAmountFilter ?? config.skuAmountFilter;
}

/** Least positive number of quantity steps whose unrounded amount meets the minimum. */
export function minimumTransferUnits(
  step: number,
  price: number | null,
  threshold: number,
): number {
  if (price === null || !Number.isFinite(price) || price < 0) return Infinity;
  if (threshold === 0) return 1;
  if (price === 0) return Infinity;
  const unitAmount = multiplyDecimal(decimal(step), decimal(price));
  const limit = decimal(threshold);
  const numerator = limit.n * unitAmount.d;
  const denominator = limit.d * unitAmount.n;
  const units = (numerator + denominator - 1n) / denominator;
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : Infinity;
}

export function getAmountExemptDonors(
  snapshot: RebalanceSnapshot,
  config: RebalanceConfig,
  outgoing: ReadonlyMap<string, number>,
): Set<string> {
  const donors = new Set<string>();
  const exception = config.stockAmountException;
  if (!exception?.enabled || !getTransferAmountFilter(config).enabled) return donors;

  for (const row of snapshot.stocks) {
    if (row.max === null) continue;
    const key = stockKey(row.skuCode, row.branchId);
    const [stock, reserved, max] = integerWeights([
      row.stock,
      outgoing.get(key) ?? 0,
      row.max,
    ]) as [bigint, bigint, bigint];
    if (stock - reserved > BigInt(exception.multiplier) * max) donors.add(key);
  }
  return donors;
}

export const transferSkuKey = (
  t: Pick<RebalanceTransfer, 'skuCode' | 'fromBranchId' | 'toBranchId'>,
) => JSON.stringify([t.skuCode, t.fromBranchId, t.toBranchId]);

/** One SKU from one physical donor to one recipient; never subsidize another line. */
export function groupTransferSkuAmounts<
  T extends Pick<
    RebalanceTransfer,
    'skuCode' | 'fromBranchId' | 'toBranchId' | 'qty'
  >,
>(snapshot: RebalanceSnapshot, lines: readonly T[]) {
  const prices = new Map(
    snapshot.skus.map((s) => [s.skuCode, s.referencePrice]),
  );
  const groups = new Map<
    string,
    {
      skuCode: string;
      fromBranchId: string;
      toBranchId: string;
      lines: T[];
      products: Array<readonly [number, number]>;
      amount: number | null;
    }
  >();
  for (const t of lines) {
    const key = transferSkuKey(t);
    const group = groups.get(key) ?? {
      skuCode: t.skuCode,
      fromBranchId: t.fromBranchId,
      toBranchId: t.toBranchId,
      lines: [],
      products: [],
      amount: 0,
    };
    group.lines.push(t);
    const price = prices.get(t.skuCode);
    if (price == null || !Number.isFinite(price) || price < 0)
      group.amount = null;
    else group.products.push([t.qty, price]);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.amount === null) continue;
    const amounts = group.products.map(([qty, price]) =>
      moneyProduct(qty, price),
    );
    const amount = amounts.every(Number.isFinite) ? moneySum(amounts) : null;
    group.amount = amount !== null && Number.isFinite(amount) ? amount : null;
  }
  return groups;
}
