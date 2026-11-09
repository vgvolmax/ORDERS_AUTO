import { describe, expect, it } from 'vitest';
import {
  applySupplierAssignmentChange,
  resolveSupplierAssignments,
  seedSupplierAssignments,
} from '../../src/domain/supplierAssignments';
import type { SupplierHistory } from '../../src/domain/types';

const primary = 'ООО "Алмаз"';
const alternative = 'ООО "Терем"';
const extra = 'ООО "Ева"';
const row = (skuCode: string, supplier: string): SupplierHistory => ({
  skuCode,
  supplier,
  skuName: null,
  unit: 'шт',
  purchaseQty: 4,
  purchaseAmount: 400,
  weightedUnitCost: 100,
});

describe('durable supplier assignments', () => {
  it('seeds unique approved names by exact code and keeps ambiguous choices linked', () => {
    const assignments = seedSupplierAssignments([
      row('001', 'ООО «АЛМАЗ»'),
      row('001', primary),
      row('1', primary),
      row('1', alternative),
      row('new', 'ООО "Алмаз Сервис"'),
    ]);
    expect(assignments).toEqual([
      { skuCode: '001', primary, additional: [] },
      { skuCode: '1', primary: null, additional: [primary, alternative] },
    ]);
  });

  it('moves an old primary into additional when assigning a different primary in bulk', () => {
    const assignments = [
      { skuCode: '001', primary, additional: [alternative, extra] },
    ];
    expect(applySupplierAssignmentChange(assignments, {
      kind: 'set-primary', skuCodes: ['001', '1', '001'], supplier: 'ооо «терем»',
    })).toEqual([
      { skuCode: '001', primary: alternative, additional: [extra, primary] },
      { skuCode: '1', primary: alternative, additional: [] },
    ]);
  });

  it('does not restore or promote an explicitly removed primary from purchase history', () => {
    const history = [row('001', primary), row('001', alternative)];
    const updated = applySupplierAssignmentChange(
      [{ skuCode: '001', primary, additional: [alternative] }],
      { kind: 'set-primary', skuCodes: ['001'], supplier: null },
    );
    expect(resolveSupplierAssignments(updated, ['001'], history)).toEqual([
      {
        skuCode: '001',
        selectedSupplier: null,
        status: 'UNRESOLVED',
        candidates: [expect.objectContaining({ supplier: alternative })],
        recommendedSupplier: null,
      },
    ]);
  });

  it('keeps additional links unique and refuses suppliers outside the fixed pool', () => {
    const assignments = [{ skuCode: '001', primary, additional: [] }];
    expect(applySupplierAssignmentChange(assignments, {
      kind: 'add-additional', skuCode: '001', supplier: 'ООО «АЛМАЗ»',
    })).toBe(assignments);
    expect(applySupplierAssignmentChange(assignments, {
      kind: 'set-primary', skuCodes: ['001'], supplier: 'ООО "Алмаз Сервис"',
    })).toBe(assignments);
    const linked = applySupplierAssignmentChange(assignments, {
      kind: 'add-additional', skuCode: '001', supplier: alternative,
    });
    expect(linked).toEqual([{ skuCode: '001', primary, additional: [alternative] }]);
    expect(applySupplierAssignmentChange(linked, {
      kind: 'remove-additional', skuCode: '001', supplier: 'ооо терем',
    })).toEqual(assignments);
  });

  it.each(['упак', null])('keeps the unit unknown across supplier aliases with unit %s', (unit) => {
    const history = [
      row('001', extra),
      { ...row('001', 'ООО «Ева»'), unit },
      row('001', 'ооо ева'),
    ];
    const [resolved] = resolveSupplierAssignments(
      seedSupplierAssignments(history), ['001'], history,
    );
    expect(resolved?.selectedSupplier).toBe(extra);
    expect(resolved?.candidates).toMatchObject([{ supplier: extra, unit: null }]);
  });
});
