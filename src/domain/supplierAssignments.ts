import { normalizeKey } from './normalize';
import { canonicalSupplierName, SUPPLIER_POOL } from './supplierPool';
import type { SupplierHistory, SupplierResolution } from './types';

export interface SupplierAssignment {
  skuCode: string;
  primary: string | null;
  additional: string[];
}

export type SupplierAssignmentCommand =
  | { kind: 'set-primary'; skuCodes: string[]; supplier: string | null }
  | {
      kind: 'add-additional' | 'remove-additional';
      skuCode: string;
      supplier: string;
    };

export function seedSupplierAssignments(
  history: readonly SupplierHistory[],
  pool: readonly string[] = SUPPLIER_POOL,
): SupplierAssignment[] {
  const suppliersBySku = new Map<string, Set<string>>();
  for (const row of history) {
    const supplier = canonicalSupplierName(row.supplier, pool);
    if (!supplier) continue;
    const suppliers = suppliersBySku.get(row.skuCode) ?? new Set<string>();
    suppliers.add(supplier);
    suppliersBySku.set(row.skuCode, suppliers);
  }
  return [...suppliersBySku].map(([skuCode, suppliers]) => {
    const names = [...suppliers];
    return {
      skuCode,
      primary: names.length === 1 ? names[0]! : null,
      additional: names.length > 1 ? names : [],
    };
  });
}

export function applySupplierAssignmentChange(
  assignments: readonly SupplierAssignment[],
  command: SupplierAssignmentCommand,
  pool: readonly string[] = SUPPLIER_POOL,
): SupplierAssignment[] {
  const supplier =
    command.supplier == null ? null : canonicalSupplierName(command.supplier, pool);
  if (supplier === undefined) return assignments as SupplierAssignment[];

  const bySku = new Map(assignments.map((item) => [item.skuCode, item]));
  const skuCodes =
    command.kind === 'set-primary' ? command.skuCodes : [command.skuCode];
  let changed = false;
  for (const skuCode of new Set(skuCodes)) {
    const current = bySku.get(skuCode) ?? {
      skuCode,
      primary: null,
      additional: [],
    };
    let next: SupplierAssignment;
    if (command.kind === 'set-primary') {
      if (current.primary === supplier) continue;
      const additional = current.additional.filter((name) => name !== supplier);
      if (current.primary && supplier) additional.push(current.primary);
      next = { ...current, primary: supplier, additional };
    } else {
      if (supplier == null || supplier === current.primary) continue;
      const linked = current.additional.includes(supplier);
      if (linked === (command.kind === 'add-additional')) continue;
      const additional = linked
        ? current.additional.filter((name) => name !== supplier)
        : [...current.additional, supplier];
      next = { ...current, additional };
    }
    if (next.primary || next.additional.length) bySku.set(skuCode, next);
    else bySku.delete(skuCode);
    changed = true;
  }
  return changed ? [...bySku.values()] : (assignments as SupplierAssignment[]);
}

export function resolveSupplierAssignments(
  assignments: readonly SupplierAssignment[],
  skuCodes: readonly string[],
  history: readonly SupplierHistory[],
  pool: readonly string[] = SUPPLIER_POOL,
  units: ReadonlyMap<string, string> = new Map(),
): SupplierResolution[] {
  const bySku = new Map(assignments.map((item) => [item.skuCode, item]));
  const historyBySku = new Map<string, Map<string, SupplierHistory>>();
  for (const row of history) {
    const name = canonicalSupplierName(row.supplier, pool);
    if (!name) continue;
    const suppliers =
      historyBySku.get(row.skuCode) ?? new Map<string, SupplierHistory>();
    const previous = suppliers.get(name);
    if (!previous) suppliers.set(name, row);
    else if (normalizeKey(previous.unit) !== normalizeKey(row.unit)) {
      // A null unit can already represent conflicts within one raw spelling.
      suppliers.set(name, { ...previous, unit: null });
    }
    historyBySku.set(row.skuCode, suppliers);
  }
  return [...new Set(skuCodes)].map((skuCode) => {
    const assignment = bySku.get(skuCode);
    const primary = assignment?.primary ?? null;
    const additional = assignment?.additional ?? [];
    const candidates = (primary ? [primary, ...additional] : additional).map(
      (supplier): SupplierHistory => {
        const row = historyBySku.get(skuCode)?.get(supplier);
        return row
          // A null historical unit may encode mixed units. It requires review,
          // even when another operator's catalog contains an apparent fallback.
          ? { ...row, supplier }
          : {
              skuCode,
              supplier,
              skuName: null,
              unit: units.get(skuCode) ?? null,
              purchaseQty: 0,
              purchaseAmount: 0,
              weightedUnitCost: null,
            };
      },
    );
    return {
      skuCode,
      selectedSupplier: primary,
      status: primary
        ? 'MANUAL_SELECTED'
        : additional.length > 1
          ? 'MANUAL_REQUIRED'
          : 'UNRESOLVED',
      candidates,
      recommendedSupplier: null,
    };
  });
}
