import { expect, it } from 'vitest';
import { donorTierContext } from '../fixtures/donorTierContext';
import {
  buildDonorAllocationModel,
  setDonorPriorityLevels,
} from '../../src/domain/rebalancing';
import { buildDonorPrioritySummary } from '../../src/features/rebalancing/donorPrioritySummary';
function input(surplus = 200) {
  const c = donorTierContext(surplus);
  c.proposal = setDonorPriorityLevels(c, 'D', [['R1', 'R2'], ['R3'], []]);
  return {
    ...c,
    fromBranchId: 'D',
    rows: buildDonorAllocationModel(c),
    registry: c.snapshot.branches,
    policies: [],
    skus: [
      {
        code: 'SKU',
        name: 'Товар',
        article: null,
        referencePrice: 10 as number | null,
        reportedTotalStock: null,
      },
    ],
    selected: [],
    rejected: [],
    query: '',
    scope: {},
  };
}
it('uses unique SKU coverage and existing document money, independent of query and selection', () => {
  const c = input(),
    s = buildDonorPrioritySummary(c);
  expect(s.groups[0]).toMatchObject({
    fullSkuCount: 1,
    partialSkuCount: 0,
    totalAmount: 1400,
    acceptedAmount: 0,
  });
  expect(s.groups.all).toMatchObject({
    fullSkuCount: 0,
    partialSkuCount: 1,
    totalAmount: 2000,
  });
  expect(
    buildDonorPrioritySummary({
      ...c,
      query: 'нет',
      selected: ['bad'],
      scope: { skuCode: 'none' },
    }).groups[0],
  ).toEqual(s.groups[0]);
});
it('deduplicates accepted sources and keeps coverage stable after accepting while excluding rejected', () => {
  const c = input(),
    t = c.proposal.transfers.find((t) => t.toBranchId === 'R1')!;
  const accepted = [
    {
      ...t,
      transferId: 'a',
      sourceRunId: c.proposal.runId,
      snapshotId: c.snapshot.snapshotId,
      acceptedAt: c.proposal.createdAt,
      acceptedConfig: c.proposal.config,
    },
  ];
  expect(buildDonorPrioritySummary({ ...c, accepted }).groups[0]).toMatchObject(
    { fullSkuCount: 1, totalAmount: 1400, acceptedAmount: 800 },
  );
  expect(
    buildDonorPrioritySummary({ ...c, rejected: [t.sourceLineId] }).groups[0],
  ).toMatchObject({ fullSkuCount: 0, partialSkuCount: 1, totalAmount: 600 });
});
it('keeps missing prices unknown and a substep deficit incomplete rather than rounding it to full', () => {
  const c = input();
  c.skus[0]!.referencePrice = null;
  expect(buildDonorPrioritySummary(c).groups[0]).toMatchObject({
    totalAmount: null,
    missingPriceLineCount: 2,
  });
  const f = donorTierContext(10, [0.3], 0.25);
  f.proposal = setDonorPriorityLevels(f, 'D', [['R1'], [], []]);
  const s = buildDonorPrioritySummary({
    ...c,
    ...f,
    rows: buildDonorAllocationModel(f),
  });
  expect(s.groups[0]).toMatchObject({ fullSkuCount: 0, partialSkuCount: 1 });
});
