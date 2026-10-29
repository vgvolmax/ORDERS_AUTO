import { normalizeKey } from '../domain/normalize';
import { validatedSnapshot } from '../domain/rebalancing/validation';
import {
  stockKey,
  type SnapshotAdapterInput,
  type SnapshotBuildResult,
  type RebalanceIssue,
} from '../domain/rebalancing/types';

/** Adapt normalized legacy inputs without inventing reserves, units, quantity steps or branch identities. */
export function createRebalanceSnapshot(
  input: SnapshotAdapterInput,
): SnapshotBuildResult {
  const issues: RebalanceIssue[] = [];
  const aliases = new Map<string, Set<string>>();
  for (const branch of input.branchRegistry)
    for (const name of [branch.name, ...branch.aliases]) {
      const key = normalizeKey(name);
      if (!key) continue;
      const ids = aliases.get(key) ?? new Set<string>();
      ids.add(branch.id);
      aliases.set(key, ids);
    }
  const policyMap = new Map(input.skuPolicies.map((p) => [p.skuCode, p]));
  const policyCounts = new Map<string, number>();
  for (const p of input.skuPolicies)
    policyCounts.set(p.skuCode, (policyCounts.get(p.skuCode) ?? 0) + 1);
  const duplicatePolicies = new Set(
    [...policyCounts].filter(([, n]) => n > 1).map(([code]) => code),
  );
  const blockedSourceKeys = new Set<string>();
  for (const issue of input.sourceIssues ?? [])
    if (
      issue.code === 'DUPLICATE_SKU_BRANCH' &&
      issue.skuCode &&
      issue.branch
    ) {
      for (const id of aliases.get(normalizeKey(issue.branch)) ?? [])
        blockedSourceKeys.add(stockKey(issue.skuCode, id));
      const ids = [...(aliases.get(normalizeKey(issue.branch)) ?? [])];
      issues.push({
        code: issue.code,
        message: issue.message,
        severity: 'ERROR',
        sourceRow: issue.row ?? null,
        skuCode: issue.skuCode,
        ...(ids.length === 1 ? { branchId: ids[0]! } : {}),
      });
    }
  const sourceRows = new Map(
    (input.sourceRows ?? []).map((r) => [
      stockKey(r.skuCode, normalizeKey(r.branch)),
      r.row,
    ]),
  );
  const stocks = input.dataset.branchStocks.flatMap((line) => {
    const ids = [...(aliases.get(normalizeKey(line.branch)) ?? [])];
    const sourceRow =
      sourceRows.get(stockKey(line.skuCode, normalizeKey(line.branch))) ?? null;
    if (ids.length !== 1) {
      issues.push({
        code: ids.length ? 'AMBIGUOUS_BRANCH_ALIAS' : 'UNKNOWN_BRANCH',
        message: `Требуется сопоставить подразделение: ${line.branch}`,
        severity: 'ERROR',
        sourceRow,
        skuCode: line.skuCode,
      });
      return [];
    }
    const branchId = ids[0]!;
    if (blockedSourceKeys.has(stockKey(line.skuCode, branchId))) return [];
    return [
      {
        skuCode: line.skuCode,
        branchId,
        stock: line.stock,
        min: line.min,
        max: line.max,
        sourceRow,
      },
    ];
  });
  const candidate = {
    schemaVersion: 1 as const,
    snapshotId: input.snapshotId,
    branches: structuredClone(input.branchRegistry),
    skus: input.dataset.skus.map((s) => {
      const p = duplicatePolicies.has(s.code)
        ? undefined
        : policyMap.get(s.code);
      return {
        skuCode: s.code,
        name: s.name,
        unit: p?.unit ?? null,
        quantityStep: p?.quantityStep ?? null,
        referencePrice: s.referencePrice,
      };
    }),
    stocks,
  };
  const validated = validatedSnapshot({
    ...candidate,
    validationIssues: issues,
  });
  return { snapshot: validated.snapshot, issues: validated.issues };
}
