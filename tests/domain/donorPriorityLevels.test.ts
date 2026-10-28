import { expect, it } from 'vitest';
import { donorTierContext, tierQuantities } from '../fixtures/donorTierContext';
import {
  setDonorPriorityLevels,
  setDonorPriorities,
  setDonorQuantity,
  setDonorSplitMode,
  buildDonorAllocationModel,
} from '../../src/domain/rebalancing/allocationPlan';
import { donorAcceptanceIds } from '../../src/domain/rebalancing';

it.each([
  [100, [80, 20, 0, 0]],
  [200, [80, 60, 20, 40]],
])(
  'fills tiers sequentially then gives remaining recipients surplus %s',
  (surplus, want) => {
    const c = donorTierContext(surplus as number),
      before = structuredClone(c);
    const p = setDonorPriorityLevels(c, 'D', [['R1'], ['R2'], ['R3']]);
    expect(tierQuantities(p)).toEqual(want);
    expect(p.allocationRevision).toBe(1);
    expect(c).toEqual(before);
    expect(p.allocationPriorityLevels?.D).toEqual([['R1'], ['R2'], ['R3']]);
  },
);
it('splits within levels and remaining in either mode, including fractional steps', () => {
  const c = donorTierContext(6, [8, 4]);
  const p = setDonorPriorityLevels(c, 'D', [['R1', 'R2'], [], []]);
  expect(tierQuantities(p)).toEqual([4, 2, 0, 0]);
  expect(
    tierQuantities(setDonorSplitMode({ ...c, proposal: p }, 'D', 'EQUAL')),
  ).toEqual([3, 3, 0, 0]);
  const f = donorTierContext(1.25, [8, 4], 0.25);
  expect(tierQuantities(setDonorPriorityLevels(f, 'D', [[], [], []]))).toEqual([
    0.75, 0.5, 0, 0,
  ]);
  expect(
    buildDonorAllocationModel({ ...c, proposal: p })[0]!.priorityRequired,
  ).toBe(false);
});
it('preserves legacy exclusive recipients; individual flags replace tier1 only after bulk', () => {
  const c = donorTierContext(200);
  expect(tierQuantities(setDonorPriorities(c, 'SKU', 'D', ['R1']))).toEqual([
    80, 0, 0, 0,
  ]);
  const p = setDonorPriorityLevels(c, 'D', [['R1'], ['R2'], ['R3']]);
  const individual = setDonorPriorities({ ...c, proposal: p }, 'SKU', 'D', [
    'R4',
  ]);
  expect(tierQuantities(individual)).toEqual([50, 60, 20, 70]);
  expect(
    buildDonorAllocationModel({ ...c, proposal: individual })[0]!
      .individualPriority,
  ).toBe(true);
});
it('protects manual rows unless overwrite is explicit and never extends accepted sources', () => {
  const c = donorTierContext(100);
  const manual = setDonorQuantity(c, 'SKU', 'D', 'R1', 10);
  const preserved = setDonorPriorityLevels({ ...c, proposal: manual }, 'D', [
    ['R2'],
    [],
    [],
  ]);
  expect(tierQuantities(preserved)).toEqual(tierQuantities(manual));
  const p = setDonorPriorityLevels(
    { ...c, proposal: preserved },
    'D',
    [['R2'], [], []],
    true,
  );
  expect(tierQuantities(p)).toEqual([19, 60, 5, 16]);
  const t = p.transfers.find((t) => t.toBranchId === 'R1')!;
  const accepted = [
    {
      ...t,
      qty: 5,
      transferId: 'a',
      sourceRunId: p.runId,
      snapshotId: p.snapshotId,
      acceptedAt: p.createdAt,
      acceptedConfig: p.config,
    },
  ];
  const next = setDonorPriorityLevels({ ...c, proposal: p, accepted }, 'D', [
    ['R1'],
    [],
    [],
  ]);
  expect(
    next.transfers.find(
      (t) => t.sourceLineId === t.sourceLineId && t.toBranchId === 'R1',
    )!.qty,
  ).toBe(5);
});
it('validates branch IDs without allowing a priority to bypass a route or missing stock', () => {
  const c = donorTierContext();
  for (const levels of [
    [['D'], [], []],
    [['bad'], [], []],
    [['R1'], ['R1'], []],
    [['R1', 'R1'], [], []],
  ])
    expect(() =>
      setDonorPriorityLevels(c, 'D', levels as [string[], string[], string[]]),
    ).toThrow();
  c.proposal.config.routeConfig = {
    mode: 'SELECTIVE',
    pairs: [{ branchAId: 'D', branchBId: 'R2', direction: 'A_TO_B' }],
  };
  c.proposal.configFingerprint = JSON.stringify('invalid');
  expect(() => setDonorPriorityLevels(c, 'D', [['R1'], [], []])).toThrow(
    'STALE_PROPOSAL',
  );
});
it('resolves group acceptance from committed positive nonrejected unaccepted lines only', () => {
  const c = donorTierContext(200),
    p = setDonorPriorityLevels(c, 'D', [['R1', 'R2'], ['R3'], []]);
  const first = p.transfers.find((t) => t.toBranchId === 'R1')!;
  const accepted = [
    {
      ...first,
      transferId: 'a',
      sourceRunId: p.runId,
      snapshotId: p.snapshotId,
      acceptedAt: p.createdAt,
      acceptedConfig: p.config,
    },
  ];
  expect(
    donorAcceptanceIds(
      { proposal: p, accepted },
      { fromBranchId: 'D', priority: 0 },
    ),
  ).toEqual([JSON.stringify(['SKU', 'D', 'R2'])]);
  expect(
    donorAcceptanceIds(
      {
        proposal: p,
        accepted,
        rejectedLineIds: [JSON.stringify(['SKU', 'D', 'R2'])],
      },
      { fromBranchId: 'D', priority: 0 },
    ),
  ).toEqual([]);
});
