import { describe, expect, it } from 'vitest';
import { formatLocalDate } from '../../src/export/date';

describe('formatLocalDate', () => {
  it('uses local calendar fields instead of UTC conversion', () => {
    const date = new Date(2026, 7, 28, 23, 59, 0);

    expect(formatLocalDate(date)).toBe('2026-08-28');
  });

  it('zero-pads month and day', () => {
    const date = new Date(2026, 0, 3, 12, 0, 0);

    expect(formatLocalDate(date)).toBe('2026-01-03');
  });
});
