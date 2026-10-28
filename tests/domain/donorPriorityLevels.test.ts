import { expect, it } from 'vitest';
import { donorTierContext, tierQuantities } from '../fixtures/donorTierContext';
import {
  setDonorPriorityLevels,
  setDonorPriorities,
  setDonorQuantity,
  setDonorSplitMode,
  buildDonorAllocationModel,
} from '../../src/domain/rebalancing/allocationPlan';
import {
  calculateRebalance,
  rebalanceConfigFingerprint,
} from '../../src/domain/rebalancing';
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
    next.transfers.find((line) => line.sourceLineId === t.sourceLineId)!.qty,
  ).toBe(5);
});
it('validates branch IDs and rejects a stale captured configuration', () => {
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

it('skips forbidden or missing priority recipients and keeps the template without blocking the next group', () => {
  const c = donorTierContext();
  c.proposal.config.routeConfig = {
    mode: 'SELECTIVE',
    pairs: [{ branchAId: 'D', branchBId: 'R2', direction: 'A_TO_B' }],
  };
  c.proposal.configFingerprint = rebalanceConfigFingerprint(c.proposal.config);
  c.proposal = {
    ...c.proposal,
    ...calculateRebalance(c.snapshot, c.proposal.config, []),
  };
  let p = setDonorPriorityLevels(c, 'D', [['R1'], ['R2'], ['R3']]);
  expect(tierQuantities(p)).toEqual([0, 60, 0, 0]);
  expect(p.allocationPriorityLevels?.D?.[0]).toEqual(['R1']);
  const missing = donorTierContext();
  missing.snapshot.stocks = missing.snapshot.stocks.filter(
    (r) => r.branchId !== 'R1',
  );
  missing.proposal = {
    ...missing.proposal,
    ...calculateRebalance(missing.snapshot, missing.proposal.config, []),
  };
  p = setDonorPriorityLevels(missing, 'D', [['R1'], ['R2'], ['R3']]);
  expect(tierQuantities(p)).toEqual([0, 60, 20, 20]);
});
it('keeps the existing explicit donor order on bulk updates and protects manual reservations first', () => {
  const c = donorTierContext(6, [8, 4]);
  c.snapshot.branches.push({ id: 'D2', name: 'D2', active: true, aliases: [] });
  c.snapshot.stocks.push({
    skuCode: 'SKU',
    branchId: 'D2',
    stock: 16,
    min: 5,
    max: 10,
    sourceRow: 9,
  });
  c.proposal = {
    ...c.proposal,
    ...calculateRebalance(c.snapshot, c.proposal.config, []),
  };
  let p = setDonorPriorityLevels(c, 'D2', [['R1'], [], []]);
  p = setDonorPriorityLevels({ ...c, proposal: p }, 'D', [['R1'], [], []]);
  expect(tierQuantities(p)).toEqual([2, 4, 0, 0]);
  p = setDonorPriorityLevels({ ...c, proposal: p }, 'D2', [['R2'], [], []]);
  expect(tierQuantities(p)).toEqual([6, 0, 0, 0]);
  expect(p.allocationDecisions!.map((d) => d.fromBranchId)).toEqual([
    'D2',
    'D',
  ]);
  p = setDonorQuantity({ ...c, proposal: p }, 'SKU', 'D', 'R1', 4);
  p = setDonorPriorityLevels({ ...c, proposal: p }, 'D2', [['R1'], [], []]);
  expect(tierQuantities(p)).toEqual([4, 0, 0, 0]);
  expect(
    p.transfers.find((t) => t.fromBranchId === 'D2' && t.toBranchId === 'R1')!
      .qty,
  ).toBe(4);
});
