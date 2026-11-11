import { normalizeKey } from './normalize';
import { hasNegativeStockNorm } from './stockNorms';
import type { MinMaxDataset, ValidationIssue } from './types';

/** Import diagnostics also govern procurement, not only the rebalance snapshot. */
export function collectPurchasingIssues(
  dataset: MinMaxDataset,
  sourceIssues: ValidationIssue[],
): ValidationIssue[] {
  const issues = sourceIssues.filter(
    (i) =>
      i.severity === 'ERROR' &&
      [
        'DUPLICATE_SKU',
        'DUPLICATE_SKU_BRANCH',
        'INVALID_BRANCH_VALUES',
        'INVALID_NORM',
      ].includes(i.code),
  );
  const seenSkus = new Set<string>();
  const seenSlices = new Set<string>();
  const issueKey = (
    code: ValidationIssue['code'],
    skuCode: string | undefined,
    branch?: string,
  ) => JSON.stringify([code, skuCode, normalizeKey(branch)]);
  const issueKeys = new Set(
    issues.map((i) => issueKey(i.code, i.skuCode, i.branch)),
  );
  const hasIssue = (
    code: ValidationIssue['code'],
    skuCode: string,
    branch?: string,
  ) => issueKeys.has(issueKey(code, skuCode, branch));
  for (const sku of dataset.skus) {
    if (seenSkus.has(sku.code) && !hasIssue('DUPLICATE_SKU', sku.code)) {
      issues.push({
        severity: 'ERROR',
        code: 'DUPLICATE_SKU',
        skuCode: sku.code,
        message: `Повторный товарный блок с кодом ${sku.code}. Исправьте дубли в отчёте MIN/MAX.`,
      });
      issueKeys.add(issueKey('DUPLICATE_SKU', sku.code));
    }
    seenSkus.add(sku.code);
  }
  for (const row of dataset.branchStocks) {
    if (hasNegativeStockNorm(row.min, row.max) && !hasIssue('INVALID_NORM', row.skuCode, row.branch)) {
      issues.push({
        severity: 'ERROR', code: 'INVALID_NORM', skuCode: row.skuCode, branch: row.branch,
        message: `Отрицательный норматив MIN/MAX: ${row.skuCode} / ${row.branch}. Укажите неотрицательные значения.`,
      });
      issueKeys.add(issueKey('INVALID_NORM', row.skuCode, row.branch));
    }
    const key = JSON.stringify([row.skuCode, normalizeKey(row.branch)]);
    if (
      seenSlices.has(key) &&
      !hasIssue('DUPLICATE_SKU_BRANCH', row.skuCode, row.branch)
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'DUPLICATE_SKU_BRANCH',
        skuCode: row.skuCode,
        branch: row.branch,
        message: `Дубликат строки подразделения: ${row.skuCode} / ${row.branch}`,
      });
      issueKeys.add(issueKey('DUPLICATE_SKU_BRANCH', row.skuCode, row.branch));
    }
    seenSlices.add(key);
  }
  return issues;
}
