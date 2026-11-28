import { normalizeKey } from './normalize';
import type { MinMaxDataset, ValidationIssue } from './types';

const sorted = (rows: readonly (readonly unknown[])[]) =>
  rows.map((row) => JSON.stringify(row)).sort();

export async function minMaxReportKey(data: MinMaxDataset, issues: readonly ValidationIssue[]) {
  const content = [
    'orders-auto:min-max:v1',
    data.branches.map(normalizeKey).sort(),
    sorted(data.skus.map(({ code, article, name, referencePrice, reportedTotalStock }) =>
      [code, article, name, referencePrice, reportedTotalStock])),
    sorted(data.branchStocks.map(({ skuCode, branch, stock, min, max }) =>
      [skuCode, normalizeKey(branch), stock, min, max])),
    sorted(issues.map(({ severity, code, skuCode, branch }) =>
      [severity, code, skuCode, branch && normalizeKey(branch)])),
  ];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
