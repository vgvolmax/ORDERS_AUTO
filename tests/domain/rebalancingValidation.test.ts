import { describe, expect, it } from 'vitest';
import { validateRebalanceSnapshot } from '../../src/domain/rebalancing/validation';
import { snapshot } from '../fixtures/rebalanceFixtures';

describe('rebalance snapshot quality', () => {
  it('accepts explicit zero norms, preserving the separate purchasing NO_NORM rule', () => {
    const input = snapshot();
    input.stocks[0]!.min = 0;
    input.stocks[0]!.max = 0;
    expect(validateRebalanceSnapshot(input)).toEqual([]);
  });
  it.each([
    ['stock', -1, 'INVALID_STOCK'],
    ['stock', Infinity, 'INVALID_STOCK'],
    ['min', null, 'MISSING_NORM'],
    ['max', null, 'MISSING_NORM'],
    ['min', 70, 'INVALID_NORM'],
    ['max', -1, 'INVALID_NORM'],
  ] as const)(
    'rejects %s=%s without inventing a norm',
    (field, value, code) => {
      const input = snapshot();
      input.stocks[0] = { ...input.stocks[0]!, [field]: value };
      expect(validateRebalanceSnapshot(input)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code,
            skuCode: '00001',
            branchId: 'D',
            sourceRow: 3,
          }),
        ]),
      );
    },
  );
  it('flags every duplicate SKU/branch record rather than keeping first or last', () => {
    const input = snapshot();
    input.stocks.push({ ...input.stocks[0]!, stock: 900, sourceRow: 9 });
    expect(
      validateRebalanceSnapshot(input)
        .filter((i) => i.code === 'DUPLICATE_SKU_BRANCH')
        .map((i) => i.sourceRow),
    ).toEqual([3, 9]);
  });
  it.each([0, -1, null, NaN])(
    'does not invent a quantity step for %s',
    (quantityStep) => {
      const input = snapshot();
      input.skus[0]!.quantityStep = quantityStep;
      expect(validateRebalanceSnapshot(input)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'INVALID_QUANTITY_POLICY' }),
        ]),
      );
    },
  );
  it('detects duplicate identities and unknown references while retaining inactive physical rows', () => {
    const input = snapshot();
    input.branches.push({ ...input.branches[0]! });
    input.skus.push({ ...input.skus[0]! });
    input.stocks[1]!.branchId = 'missing';
    expect(validateRebalanceSnapshot(input).map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_BRANCH_ID',
        'DUPLICATE_SKU_ID',
        'UNKNOWN_BRANCH',
      ]),
    );
    const inactive = snapshot();
    inactive.branches[0]!.active = false;
    expect(validateRebalanceSnapshot(inactive)).toEqual([]);
  });
  it('reports bad price as unknown financial data without preventing quantity planning', () => {
    const input = snapshot();
    input.skus[0]!.referencePrice = -10;
    expect(validateRebalanceSnapshot(input)).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PRICE', severity: 'WARNING' }),
    );
  });
});
