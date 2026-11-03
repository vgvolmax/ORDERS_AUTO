import {
  addDecimal,
  decimal,
  decimalNumber,
  multiplyDecimal,
  sumDecimals,
} from './decimal';

/** No price/line rounding: retain the full weighted unit cost until presentation. */
export function moneyProduct(qty: number, price: number): number {
  return decimalNumber(multiplyDecimal(decimal(qty), decimal(price)));
}

export function moneySum(values: Iterable<number>): number {
  return decimalNumber(sumDecimals(values));
}

/** Compare the original products, never a rounded display total or epsilon. */
export function moneyProductsLessThan(
  products: Iterable<readonly [number, number]>,
  threshold: number,
): boolean {
  let total = decimal(0);
  for (const [qty, price] of products)
    total = addDecimal(total, multiplyDecimal(decimal(qty), decimal(price)));
  const limit = decimal(threshold);
  return total.n * limit.d < limit.n * total.d;
}
