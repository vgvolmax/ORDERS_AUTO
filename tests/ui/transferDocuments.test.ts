import { expect, it } from 'vitest';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import {
  buildTransferDocuments,
  summarizeTransferDocuments,
} from '../../src/features/rebalancing/transferDocuments';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

function input() {
  const state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  return {
    proposal: state.rebalance.proposal,
    accepted: state.rebalance.accepted,
    registry: state.rebalance.registry,
    policies: state.rebalance.policies,
    skus: state.minMax!.skus,
    snapshot: derive(state).snapshot!.snapshot,
    selected: [] as string[],
    rejected: [] as string[],
    query: '',
    scope: {},
  };
}
it('summarizes accepted, selected and rejected money without double counting or inventing unknown prices', () => {
  const data = input();
  const line = data.proposal.transfers[0]!;
  data.accepted = [
    {
      ...line,
      transferId: 'accepted',
      sourceRunId: data.proposal.runId,
      snapshotId: data.proposal.snapshotId,
      acceptedAt: '2026-10-22',
      acceptedConfig: data.proposal.config,
    },
  ];
  data.selected = [data.proposal.transfers[1]!.sourceLineId];
  expect(
    summarizeTransferDocuments(buildTransferDocuments(data)),
  ).toMatchObject({
    totalAmount: 5000,
    acceptedAmount: 1500,
    selectedAmount: 3500,
    activeCount: 2,
    acceptedCount: 1,
    selectedCount: 1,
    rejectedCount: 0,
  });
  data.skus[0] = { ...data.skus[0]!, referencePrice: null };
  expect(
    summarizeTransferDocuments(buildTransferDocuments(data)),
  ).toMatchObject({ totalAmount: null, acceptedAmount: null });
  data.skus[0] = { ...data.skus[0]!, referencePrice: 0 };
  data.rejected = [data.proposal.transfers[1]!.sourceLineId];
  expect(
    summarizeTransferDocuments(buildTransferDocuments(data)),
  ).toMatchObject({
    totalAmount: 0,
    acceptedAmount: 0,
    activeCount: 1,
    acceptedCount: 1,
    selectedCount: 0,
    rejectedCount: 1,
  });
});
it('groups by stable directed branch IDs and resolves product identity only by exact code', () => {
  const data = input();
  const before = structuredClone(data);
  const docs = buildTransferDocuments(data);
  expect(docs).toHaveLength(2);
  expect(docs[0]).toMatchObject({
    fromBranchId: 'b0',
    toBranchId: 'b2',
    fromName: 'Донор А',
    toName: 'Получатель',
    skuCount: 1,
    totalAmount: 1500,
  });
  expect(docs[0]!.lines[0]).toMatchObject({
    skuCode: 'SKU1',
    article: 'A1',
    name: 'Товар для перемещения',
    qty: 15,
    decision: 'PROPOSED',
    from: { physical: 75, current: 75, afterLine: 60, min: 20, max: 60 },
    to: { physical: 10, current: 10, afterLine: 25 },
  });
  expect(data).toEqual(before);
});
it('shows accepted rows once and uses all accepted routes without counting accepted lines twice', () => {
  let state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  const a = state.rebalance.proposal.transfers.find(
    (line) => line.fromBranchId === 'b0',
  )!;
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'accept',
      ids: [a.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
  const docs = buildTransferDocuments({
    ...input(),
    proposal: state.rebalance.proposal,
    accepted: state.rebalance.accepted,
  });
  expect(docs.flatMap((doc) => doc.lines)).toHaveLength(2);
  expect(docs[0]!.lines[0]).toMatchObject({
    decision: 'ACCEPTED',
    from: { physical: 75, current: 60, afterLine: 60 },
    to: { physical: 10, current: 25, afterLine: 25 },
  });
  expect(docs[1]!.lines[0]).toMatchObject({
    decision: 'PROPOSED',
    to: { physical: 10, current: 25, afterLine: 60 },
  });
});
it('keeps decimal units separate and an incomplete amount unknown, preserving known zero prices', () => {
  const data = input();
  data.skus.push({
    ...data.skus[0]!,
    code: '00001',
    name: 'Труба',
    article: 'PPR',
    referencePrice: null,
  });
  data.policies.push({ skuCode: '00001', unit: 'м', quantityStep: 0.1 });
  data.proposal.transfers.push({
    ...data.proposal.transfers[0]!,
    sourceLineId: 'pipe',
    skuCode: '00001',
    qty: 0.3,
  });
  const doc = buildTransferDocuments(data)[0]!;
  expect(doc.skuCount).toBe(2);
  expect(doc.totalAmount).toBeNull();
  expect(doc.totalsByUnit).toEqual([
    { unit: 'м', qty: 0.3 },
    { unit: 'шт', qty: 15 },
  ]);
  data.skus[1]!.referencePrice = 0;
  expect(buildTransferDocuments(data)[0]!.totalAmount).toBe(1500);
});
it('filters exact SKU and either endpoint, searches name and article, and preserves rejected decisions', () => {
  const data = input();
  data.skus.push({ ...data.skus[0]!, code: 'SKU10' });
  data.proposal.transfers.push({
    ...data.proposal.transfers[0]!,
    sourceLineId: 'prefix',
    skuCode: 'SKU10',
  });
  data.rejected = [data.proposal.transfers[0]!.sourceLineId];
  data.selected = [data.proposal.transfers[0]!.sourceLineId];
  const docs = buildTransferDocuments({
    ...data,
    scope: { skuCode: 'SKU1', branchId: 'b0' },
    query: 'A1',
  });
  expect(docs).toHaveLength(1);
  expect(docs[0]!.lines).toHaveLength(1);
  expect(docs[0]!.lines[0]).toMatchObject({
    skuCode: 'SKU1',
    decision: 'REJECTED',
    selected: false,
  });
  expect(
    buildTransferDocuments({ ...data, scope: { branchId: 'missing' } }),
  ).toEqual([]);
  expect(
    buildTransferDocuments({ ...data, query: 'товар для перемещения' }),
  ).toHaveLength(2);
});
