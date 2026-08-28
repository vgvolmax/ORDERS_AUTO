import { describe, expect, it } from 'vitest';
import { calculateStockStatus } from '../../src/domain/demand';
import { normalizeText, parseOptionalNumber } from '../../src/domain/normalize';

describe('domain', () => {
  it('normalizes text and numbers from 1C reports', () => {
    expect(normalizeText(' Наро\u00a0Фоминск ')).toBe('Наро Фоминск');
    expect(parseOptionalNumber('1 234,5')).toBe(1234.5);
  });

  it.each([
    [40, 'OK'],
    [39, 'YELLOW'],
    [30, 'YELLOW'],
    [29, 'ORANGE'],
    [20, 'ORANGE'],
    [19, 'BELOW_MIN'],
    [0, 'BELOW_MIN'],
  ] as const)('maps stock %s to %s', (stock, status) => {
    expect(calculateStockStatus(stock, 20, 40).status).toBe(status);
  });

  it('validates missing and inconsistent norms', () => {
    expect(calculateStockStatus(5, null, 40).status).toBe('LIGHT_RED');
    expect(calculateStockStatus(5, 50, 40).status).toBe('INVALID_NORM');
    expect(calculateStockStatus(5, 2, null).status).toBe('NO_NORM');
  });
});
