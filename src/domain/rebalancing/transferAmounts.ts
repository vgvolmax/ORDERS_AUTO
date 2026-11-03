import { moneyProduct, moneySum } from '../money';
import type {
  RebalanceConfig,
  RebalanceSnapshot,
  RebalanceTransfer,
} from './types';

/** Live legacy settings retain their enabled/value; historical accepted configs are not migrated. */
export function getTransferAmountFilter(config: RebalanceConfig) {
  return config.transferAmountFilter ?? config.skuAmountFilter;
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
