import { describe, expect, it } from 'vitest';
import {
  moneyProduct,
  moneySum,
  moneyProductsLessThan,
} from '../../src/domain/money';

describe('decimal procurement money', () => {
  it('sums signed decimal amounts without binary accumulation', () => {
    expect(moneySum([10.1, 20.2])).toBe(30.3);
    expect(moneySum([0.1, 0.2, -0.3])).toBe(0);
    expect(moneySum([])).toBe(0);
  });
  it('retains sub-cent unit cost and exact fractional products', () => {
    expect(moneyProduct(3, 0.1)).toBe(0.3);
    expect(moneyProduct(0.25, 1.23456)).toBe(0.30864);
  });
  it('compares original decimal products before converting their sum to Number', () => {
    expect(
      moneyProductsLessThan(
        [
          [1, 10.1],
          [1, 20.2],
        ],
        30.3,
      ),
    ).toBe(false);
    expect(moneyProductsLessThan([[3, 0.3333333333333333]], 1)).toBe(true);
    expect(
      moneyProductsLessThan([[0.3, 0.10000000000000002]], 0.030000000000000006),
    ).toBe(false);
    expect(
      moneyProductsLessThan([[3, 1000000000000000.1]], 3000000000000000.5),
    ).toBe(true);
  });
});
