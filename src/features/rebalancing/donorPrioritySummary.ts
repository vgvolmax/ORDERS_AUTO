import { acceptedTotals } from '../../domain/rebalancing/constraints';
import {
  donorAcceptanceIds,
  stockKey,
  type DonorPriorityLevels,
} from '../../domain/rebalancing';
import { sumQuantities } from '../../domain/rebalancing/numbers';
import type { DonorAllocationRow } from '../../domain/rebalancing/allocationPlan';
import {
  buildTransferDocuments,
  summarizeTransferDocuments,
  type TransferDocumentsInput,
} from './transferDocuments';

export interface DonorPriorityGroup {
  totalAmount: number | null;
  acceptedAmount: number | null;
  missingPriceLineCount: number;
  fullSkuCount: number;
  partialSkuCount: number;
  rowCoverage: Map<string, 'FULL' | 'PARTIAL'>;
  sourceLineIds: string[];
}
export interface DonorPrioritySummary {
  levels: DonorPriorityLevels;
  groups: Record<'all' | 0 | 1 | 2, DonorPriorityGroup>;
  manualCount: number;
  individualCount: number;
}
/** One projection for counters, filters and bulk previews. Pending is a forecast, never an order change. */
export function buildDonorPrioritySummary(
  input: TransferDocumentsInput & {
    fromBranchId: string;
    rows: DonorAllocationRow[];
  },
): DonorPrioritySummary {
  const { proposal, accepted, snapshot, fromBranchId, rows } = input;
  const levels = proposal?.allocationPriorityLevels?.[fromBranchId] ?? [
    [],
    [],
    [],
  ];
  const sources = new Set(
    accepted
      .filter((t) => t.sourceRunId === proposal?.runId)
      .map((t) => t.sourceLineId),
  );
  const rejected = new Set(input.rejected);
  const pending =
    proposal?.transfers.filter(
      (t) => !sources.has(t.sourceLineId) && !rejected.has(t.sourceLineId),
    ) ?? [];
  const totals = acceptedTotals([...accepted, ...pending]);
  const after = new Map(
    snapshot?.stocks.map((s) => {
      const key = stockKey(s.skuCode, s.branchId);
      return [
        key,
        sumQuantities([
          s.stock,
          totals.incoming.get(key) ?? 0,
          -(totals.outgoing.get(key) ?? 0),
        ]),
      ];
    }),
  );
  const docs = buildTransferDocuments({
    ...input,
    query: '',
    scope: {},
    selected: [],
  }).filter((d) => d.fromBranchId === fromBranchId);
  const group = (priority: 0 | 1 | 2 | null): DonorPriorityGroup => {
    const members = priority === null ? null : new Set(levels[priority]);
    const documents = docs.filter((d) => !members || members.has(d.toBranchId));
    const amounts = summarizeTransferDocuments(documents);
    const rowCoverage = new Map<string, 'FULL' | 'PARTIAL'>();
    for (const row of rows) {
      const cells = row.cells.filter(
        (c) =>
          (!members || members.has(c.toBranchId)) &&
          c.max > 0 &&
          c.stock < c.max,
      );
      if (cells.length)
        rowCoverage.set(
          row.skuCode,
          cells.every((c) => {
            const value = after.get(stockKey(row.skuCode, c.toBranchId));
            return value !== undefined && sumQuantities([c.max, -value]) <= 0;
          })
            ? 'FULL'
            : 'PARTIAL',
        );
    }
    return {
      totalAmount: amounts.totalAmount,
      acceptedAmount: amounts.acceptedAmount,
      missingPriceLineCount: documents
        .flatMap((d) => d.lines)
        .filter((l) => l.decision !== 'REJECTED' && l.amount === null).length,
      fullSkuCount: [...rowCoverage.values()].filter((v) => v === 'FULL')
        .length,
      partialSkuCount: [...rowCoverage.values()].filter((v) => v === 'PARTIAL')
        .length,
      rowCoverage,
      sourceLineIds: donorAcceptanceIds(
        { proposal, accepted, rejectedLineIds: input.rejected },
        { fromBranchId, priority },
      ),
    };
  };
  return {
    levels,
    groups: { all: group(null), 0: group(0), 1: group(1), 2: group(2) },
    manualCount: rows.filter((r) => r.decisionMode === 'MANUAL').length,
    individualCount: rows.filter((r) => r.individualPriority).length,
  };
}
