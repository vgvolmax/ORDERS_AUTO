import { expect, it } from 'vitest';
import { buildFullCoverageSummary } from '../../src/features/rebalancing/skippedRebalance';
import { createProposal } from '../../src/app/rebalanceActions';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it('reports the whole skipped need14 rather than the actual shortage2 and keeps missing prices unknown', () => {
  const state = rebalanceAppState();
  const proposal = {
    ...createProposal(state),
    skippedSkus: [
      {
        skuCode: 'SKU1',
        neededQty: 14,
        deliverableQty: 12,
        missingQty: 2,
        reason: 'INSUFFICIENT_SURPLUS' as const,
        recipients: [],
      },
      {
        skuCode: 'X',
        neededQty: 2,
        deliverableQty: 0,
        missingQty: 2,
        reason: 'ROUTE_LIMIT' as const,
        recipients: [],
      },
    ],
  };
  const result = buildFullCoverageSummary({
    proposal,
    accepted: [],
    rejectedLineIds: [],
    policies: [
      ...state.rebalance.policies,
      { skuCode: 'X', unit: 'м', quantityStep: 1 },
    ],
    skus: [
      ...state.minMax!.skus,
      {
        code: 'X',
        name: 'Без цены',
        article: null,
        referencePrice: null,
        reportedTotalStock: null,
      },
    ],
  });
  expect(result.skipped.byUnit).toEqual([
    { unit: 'м', qty: 2 },
    { unit: 'шт', qty: 14 },
  ]);
  expect(result.skipped.amount).toBeNull();
  expect(result.skipped.knownAmount).toBe(1400);
  expect(result.skipped.missingPriceSkuCount).toBe(1);
});
it('pending excludes accepted sources and rejections, separately from total proposal volume', () => {
  const state = rebalanceAppState(),
    proposal = createProposal(state);
  const accepted = [
    {
      ...proposal.transfers[0]!,
      transferId: 'accepted',
      sourceRunId: proposal.runId,
      snapshotId: state.snapshotId,
      acceptedConfig: proposal.config,
      acceptedAt: '2026-10-29T10:00:00Z',
    },
  ];
  const input = {
    proposal,
    accepted,
    rejectedLineIds: [],
    policies: state.rebalance.policies,
    skus: state.minMax!.skus,
  };
  expect(buildFullCoverageSummary(input).pending).toMatchObject({
    amount: 3500,
    byUnit: [{ unit: 'шт', qty: 35 }],
    skuCount: 1,
    lineCount: 1,
  });
  expect(
    buildFullCoverageSummary({
      ...input,
      rejectedLineIds: [proposal.transfers[1]!.sourceLineId],
    }).pending,
  ).toMatchObject({ amount: 0, byUnit: [], lineCount: 0 });
});
