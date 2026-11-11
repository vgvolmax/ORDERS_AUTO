import { describe, expect, it } from 'vitest';
import { buildSkuOrder } from '../../src/domain/skuOrder';

describe('MIN/MAX SKU order', () => {
  it('uses the first source occurrence and then a deterministic natural order for unknown codes', () => {
    const compare = buildSkuOrder(['X20', 'X1', 'X20', 'X3']);
    const codes = ['X10', 'X3', 'X2', 'X20', 'X1', 'X02'];

    expect(codes.sort(compare)).toEqual(['X20', 'X1', 'X3', 'X02', 'X2', 'X10']);
  });
});
