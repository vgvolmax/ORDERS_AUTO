import { describe, expect, it } from 'vitest';
import { safeFilename, uniqueSheetName } from '../../src/export/filenames';

describe('export names', () => {
  it('sanitizes Windows filenames', () => {
    expect(safeFilename('ООО: Тест / склад. ')).toBe('ООО_ Тест _ склад');
  });

  it('creates unique Excel sheet names within 31 characters', () => {
    const used = new Set<string>();
    const first = uniqueSheetName('Очень длинное подразделение с / символом', used);
    const second = uniqueSheetName('Очень длинное подразделение с / символом', used);

    expect(first.length).toBeLessThanOrEqual(31);
    expect(second.length).toBeLessThanOrEqual(31);
    expect(second).not.toBe(first);
  });
});
