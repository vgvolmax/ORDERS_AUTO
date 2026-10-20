import { normalizeKey } from '../domain/normalize';
import { validateRebalanceSnapshot } from '../domain/rebalancing/validation';
import { stockKey, type SnapshotAdapterInput, type SnapshotBuildResult, type RebalanceIssue } from '../domain/rebalancing/types';

/** Adapt normalized legacy inputs without inventing reserves, units, quantity steps or branch identities. */
export function createRebalanceSnapshot(input: SnapshotAdapterInput): SnapshotBuildResult {
  const issues: RebalanceIssue[] = [];
  const aliases = new Map<string, Set<string>>();
  for (const branch of input.branchRegistry) for (const name of [branch.name, ...branch.aliases]) {
    const key = normalizeKey(name); if (!key) continue;
    const ids = aliases.get(key) ?? new Set<string>(); ids.add(branch.id); aliases.set(key, ids);
  }
  const policyMap = new Map(input.skuPolicies.map((p) => [p.skuCode, p]));
  const duplicatePolicies = new Set(input.skuPolicies.filter((p, i, all) => all.findIndex((v) => v.skuCode === p.skuCode) !== i).map((p) => p.skuCode));
  const blockedSourceKeys = new Set<string>();
  for (const issue of input.sourceIssues ?? []) if (issue.code === 'DUPLICATE_SKU_BRANCH' && issue.skuCode && issue.branch) {
    for (const id of aliases.get(normalizeKey(issue.branch)) ?? []) blockedSourceKeys.add(stockKey(issue.skuCode, id));
    issues.push({ code: issue.code, message: issue.message, severity: 'ERROR', sourceRow: issue.row ?? null, skuCode: issue.skuCode });
  }
  const sourceRows = new Map((input.sourceRows ?? []).map((r) => [stockKey(r.skuCode, normalizeKey(r.branch)), r.row]));
  const stocks = input.dataset.branchStocks.flatMap((line) => {
    const ids = [...(aliases.get(normalizeKey(line.branch)) ?? [])];
    const sourceRow = sourceRows.get(stockKey(line.skuCode, normalizeKey(line.branch))) ?? null;
    if (ids.length !== 1) {
      issues.push({ code: ids.length ? 'AMBIGUOUS_BRANCH_ALIAS' : 'UNKNOWN_BRANCH', message: `Требуется сопоставить подразделение: ${line.branch}`, severity: 'ERROR', sourceRow, skuCode: line.skuCode });
      return [];
    }
    const branchId = ids[0]!;
    if (blockedSourceKeys.has(stockKey(line.skuCode, branchId))) return [];
    return [{ skuCode: line.skuCode, branchId, stock: line.stock, min: line.min, max: line.max, sourceRow }];
  });
  const candidate = {
    schemaVersion: 1 as const, snapshotId: input.snapshotId,
    branches: structuredClone(input.branchRegistry),
    skus: input.dataset.skus.map((s) => {
      const p = duplicatePolicies.has(s.code) ? undefined : policyMap.get(s.code);
      return { skuCode: s.code, name: s.name, unit: p?.unit ?? null, quantityStep: p?.quantityStep ?? null, referencePrice: s.referencePrice };
    }), stocks,
  };
  const validation = validateRebalanceSnapshot(candidate); issues.push(...validation);
  const invalidSkus = new Set(validation.filter((i) => i.severity === 'ERROR' && i.skuCode && i.stockIndex === undefined).map((i) => i.skuCode));
  const invalidBranches = new Set(validation.filter((i) => i.severity === 'ERROR' && i.branchId && i.stockIndex === undefined).map((i) => i.branchId));
  const invalidRows = new Set(validation.filter((i) => i.severity === 'ERROR' && i.stockIndex !== undefined).map((i) => i.stockIndex));
  const rootInvalid = validation.some((i) => i.severity === 'ERROR' && !i.skuCode && !i.branchId && i.stockIndex === undefined);
  return { snapshot: {
    ...candidate,
    branches: candidate.branches.filter((b) => !invalidBranches.has(b.id)),
    skus: candidate.skus.filter((s) => !invalidSkus.has(s.skuCode)).map((s) => ({ ...s, referencePrice: s.referencePrice !== null && (!Number.isFinite(s.referencePrice) || s.referencePrice < 0) ? null : s.referencePrice })),
    stocks: rootInvalid ? [] : stocks.filter((s, i) => !invalidRows.has(i) && !invalidSkus.has(s.skuCode) && !invalidBranches.has(s.branchId)),
  }, issues };
}
