import { moneyProduct, moneySum } from '../../domain/money';
import { buildSkuOrder } from '../../domain/skuOrder';
import type { Sku } from '../../domain/types';
import type { RebalanceResultScope } from '../../domain/workspace';
import {
  stockKey,
  type AcceptedTransfer,
  type BranchRegistry,
  type RebalanceProposal,
  type RebalanceSnapshot,
  type SkuQuantityPolicy,
} from '../../domain/rebalancing';
import { acceptedTotals } from '../../domain/rebalancing/constraints';
import { sumQuantities } from '../../domain/rebalancing/numbers';

export interface TransferDocumentsInput {
  proposal: RebalanceProposal | null;
  accepted: AcceptedTransfer[];
  registry: BranchRegistry;
  policies: SkuQuantityPolicy[];
  skus: Sku[];
  snapshot: RebalanceSnapshot | null;
  selected: string[];
  rejected: string[];
  query: string;
  scope: RebalanceResultScope;
}
export interface TransferStockView {
  physical: number;
  current: number;
  afterLine: number;
  min: number | null;
  max: number | null;
}
export interface TransferDocumentLine {
  id: string;
  sourceLineId: string;
  transferId: string | null;
  skuCode: string;
  article: string | null;
  name: string;
  qty: number;
  originalQty?: number | undefined;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  decision: 'PROPOSED' | 'REJECTED' | 'ACCEPTED';
  selected: boolean;
  from: TransferStockView | null;
  to: TransferStockView | null;
}
export const transferDecisionLabel = {
  PROPOSED: 'Предложено',
  REJECTED: 'Отклонено',
  ACCEPTED: 'Принято',
} satisfies Record<TransferDocumentLine['decision'], string>;

export interface TransferDocument {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  fromName: string;
  toName: string;
  lines: TransferDocumentLine[];
  skuCount: number;
  totalAmount: number | null;
  totalsByUnit: { unit: string | null; skuCode?: string; qty: number }[];
}

export interface TransferDirection {
  id: string;
  fromName: string;
  toName: string;
  lines: TransferDocumentLine[];
}

export function buildTransferDirections(docs: TransferDocument[]) {
  const directionsBySku = new Map<string, TransferDirection[]>();
  for (const { id, fromName, toName, lines } of docs) {
    const directionBySku = new Map<string, TransferDirection>();
    for (const line of lines) {
      let direction = directionBySku.get(line.skuCode);
      if (!direction) {
        direction = { id, fromName, toName, lines: [] };
        directionBySku.set(line.skuCode, direction);
        const directions = directionsBySku.get(line.skuCode);
        if (directions) directions.push(direction);
        else directionsBySku.set(line.skuCode, [direction]);
      }
      direction.lines.push(line);
    }
  }
  return directionsBySku;
}

export function summarizeTransferDocuments(docs: TransferDocument[]) {
  const lines = docs.flatMap((doc) => doc.lines);
  const active = lines.filter((line) => line.decision !== 'REJECTED');
  const accepted = active.filter((line) => line.decision === 'ACCEPTED');
  const amount = (items: TransferDocumentLine[]) => {
    if (items.some((line) => line.amount === null)) return null;
    const value = moneySum(items.map((line) => line.amount!));
    return Number.isFinite(value) ? value : null;
  };
  return {
    totalAmount: amount(active),
    acceptedAmount: amount(accepted),
    selectedAmount: amount(active.filter((line) => line.selected)),
    activeCount: active.length,
    acceptedCount: accepted.length,
    proposedCount: active.length - accepted.length,
    rejectedCount: lines.length - active.length,
    selectedCount: active.filter((line) => line.selected).length,
  };
}

/** Read-only projection. Opening and filtering never mutate purchasing decisions. */
export function buildTransferDocuments(
  input: TransferDocumentsInput,
): TransferDocument[] {
  const { proposal, accepted, snapshot, scope } = input;
  const names = new Map(input.registry.map((b) => [b.id, b.name]));
  const skus = new Map(input.skus.map((s) => [s.code, s]));
  const compareSku = buildSkuOrder(input.skus.map((sku) => sku.code));
  const policies = new Map(input.policies.map((p) => [p.skuCode, p]));
  const stocks = new Map(
    snapshot?.stocks.map((s) => [stockKey(s.skuCode, s.branchId), s]),
  );
  const totals = acceptedTotals(accepted);
  const selected = new Set(input.selected),
    rejected = new Set(input.rejected);
  const sources = new Set(
    accepted.map((t) => JSON.stringify([t.sourceRunId, t.sourceLineId])),
  );
  const groups = new Map<string, TransferDocument>();
  const query = input.query.trim().toLocaleLowerCase('ru');
  const transfers = [
    ...(proposal?.transfers ?? [])
      .filter(
        (t) => !sources.has(JSON.stringify([proposal!.runId, t.sourceLineId])),
      )
      .map((t) => ({
        ...t,
        transferId: null,
        decision: rejected.has(t.sourceLineId)
          ? ('REJECTED' as const)
          : ('PROPOSED' as const),
      })),
    ...accepted.map((t) => ({ ...t, decision: 'ACCEPTED' as const })),
  ];
  for (const t of transfers) {
    const sku = skus.get(t.skuCode);
    const fromName = names.get(t.fromBranchId) ?? t.fromBranchId;
    const toName = names.get(t.toBranchId) ?? t.toBranchId;
    if (
      (scope.skuCode && t.skuCode !== scope.skuCode) ||
      (scope.branchId &&
        t.fromBranchId !== scope.branchId &&
        t.toBranchId !== scope.branchId) ||
      ![t.skuCode, sku?.article ?? '', sku?.name ?? '', fromName, toName]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(query)
    )
      continue;
    const side = (
      branchId: string,
      delta: number,
    ): TransferStockView | null => {
      const key = stockKey(t.skuCode, branchId),
        row = stocks.get(key);
      if (!row) return null;
      const current = sumQuantities([
        row.stock,
        totals.incoming.get(key) ?? 0,
        -(totals.outgoing.get(key) ?? 0),
      ]);
      return {
        physical: row.stock,
        current,
        afterLine:
          t.decision === 'ACCEPTED' ? current : sumQuantities([current, delta]),
        min: row.min,
        max: row.max,
      };
    };
    const price = sku?.referencePrice;
    const unitPrice =
      price !== undefined &&
      price !== null &&
      Number.isFinite(price) &&
      price >= 0
        ? price
        : null;
    const amount =
      unitPrice !== null && Number.isFinite(moneyProduct(t.qty, unitPrice))
        ? moneyProduct(t.qty, unitPrice)
        : null;
    const id = JSON.stringify([t.fromBranchId, t.toBranchId]);
    const doc: TransferDocument = groups.get(id) ?? {
      id,
      fromBranchId: t.fromBranchId,
      toBranchId: t.toBranchId,
      fromName,
      toName,
      lines: [],
      skuCount: 0,
      totalAmount: null,
      totalsByUnit: [],
    };
    doc.lines.push({
      id: t.transferId
        ? 'accepted:' + t.transferId
        : 'proposal:' + proposal!.runId + ':' + t.sourceLineId,
      transferId: t.transferId,
      sourceLineId: t.sourceLineId,
      skuCode: t.skuCode,
      article: sku?.article ?? null,
      name: sku?.name ?? t.skuCode,
      qty: t.qty,
      originalQty: t.originalQty,
      unit: policies.get(t.skuCode)?.unit ?? null,
      unitPrice,
      amount,
      decision: t.decision,
      selected: t.decision === 'PROPOSED' && selected.has(t.sourceLineId),
      from: side(t.fromBranchId, -t.qty),
      to: side(t.toBranchId, t.qty),
    });
    groups.set(id, doc);
  }
  for (const doc of groups.values()) {
    doc.lines.sort(
      (a, b) =>
        compareSku(a.skuCode, b.skuCode) || a.id.localeCompare(b.id),
    );
    doc.skuCount = new Set(doc.lines.map((l) => l.skuCode)).size;
    const active = doc.lines.filter((l) => l.decision !== 'REJECTED');
    doc.totalAmount = active.some((l) => l.amount === null)
      ? null
      : moneySum(active.map((line) => line.amount!));
    if (doc.totalAmount !== null && !Number.isFinite(doc.totalAmount))
      doc.totalAmount = null;
    const units = new Map<
      string,
      { unit: string | null; skuCode?: string; values: number[] }
    >();
    for (const line of active) {
      const key = line.unit ? 'unit:' + line.unit : 'sku:' + line.skuCode;
      const group = units.get(key) ?? {
        unit: line.unit,
        ...(line.unit ? {} : { skuCode: line.skuCode }),
        values: [],
      };
      group.values.push(line.qty);
      units.set(key, group);
    }
    doc.totalsByUnit = [...units.values()].map(({ values, ...unit }) => ({
      ...unit,
      qty: sumQuantities(values),
    }));
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.fromName.localeCompare(b.fromName, 'ru') ||
      a.toName.localeCompare(b.toName, 'ru') ||
      a.id.localeCompare(b.id),
  );
}
