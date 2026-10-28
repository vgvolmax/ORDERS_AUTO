import { expect, it } from 'vitest';
import { donorTierContext, tierQuantities } from '../fixtures/donorTierContext';
import {
  acceptTransfers,
  buildDonorAllocationModel,
  calculateRebalance,
  rebalanceConfigFingerprint,
  revokeTransfers,
  setDonorPriorities,
  setDonorPriorityLevels,
  setDonorSplitMode,
  type AllocationContext,
} from '../../src/domain/rebalancing';

// D can serve everyone; D2 can serve only the named receiver. No fixed D2
// decision remains to reserve that receiver after its accepted transfer is revoked.
function context(needs: number[], secondReceiver: string) {
  const c = donorTierContext(5, needs);
  c.snapshot.branches.push({ id: 'D2', name: 'D2', active: true, aliases: [] });
  c.snapshot.stocks.push({
    skuCode: 'SKU',
    branchId: 'D2',
    stock: 15,
    min: 5,
    max: 10,
    sourceRow: 9,
  });
  c.proposal.config.routeConfig = {
    mode: 'SELECTIVE',
    pairs: [
      ...needs.map((_, i) => ({
        branchAId: 'D',
        branchBId: `R${i + 1}`,
        direction: 'A_TO_B' as const,
      })),
      { branchAId: 'D2', branchBId: secondReceiver, direction: 'A_TO_B' },
    ],
  };
  c.proposal.configFingerprint = rebalanceConfigFingerprint(c.proposal.config);
  c.proposal = {
    ...c.proposal,
    ...calculateRebalance(c.snapshot, c.proposal.config, []),
  };
  return c;
}
function acceptSecondDonor(c: AllocationContext) {
  const line = c.proposal.transfers.find((t) => t.fromBranchId === 'D2')!;
  expect(line.qty).toBe(5);
  return acceptTransfers({
    snapshot: c.snapshot,
    currentAccepted: c.accepted,
    currentProposal: c.proposal,
    selectedLineIds: [line.sourceLineId],
    currentRevision: 0,
    expectedRevision: 0,
    currentConfigFingerprint: c.proposal.configFingerprint,
    acceptedAt: c.proposal.createdAt,
    transferIdBySourceLineId: { [line.sourceLineId]: 'accepted-D2' },
  }).nextAccepted;
}
function revokeSecondDonor(c: AllocationContext) {
  return revokeTransfers({
    snapshot: c.snapshot,
    currentAccepted: c.accepted,
    transferIds: ['accepted-D2'],
    currentRevision: 1,
    expectedRevision: 1,
  }).nextAccepted;
}

it.each(['PROPORTIONAL', 'EQUAL'] as const)(
  'keeps a bulk first priority when accepted demand returns after revocation (%s)',
  (mode) => {
    const c = context([5, 5], 'R1');
    const accepted = acceptSecondDonor(c);
    const proposal = setDonorPriorityLevels({ ...c, accepted }, 'D', [
      ['R1'],
      ['R2'],
      [],
    ]);
    const next = setDonorSplitMode(
      {
        ...c,
        proposal,
        accepted: revokeSecondDonor({ ...c, proposal, accepted }),
      },
      'D',
      mode,
    );
    expect(tierQuantities(next)).toEqual([5, 0, 0, 0]);
    expect(
      buildDonorAllocationModel({ ...c, proposal, accepted }).find(
        (r) => r.fromBranchId === 'D',
      )!.individualPriority,
    ).toBe(false);
    expect(
      buildDonorAllocationModel({ ...c, proposal: next, accepted: [] }).find(
        (r) => r.fromBranchId === 'D',
      )!.individualPriority,
    ).toBe(false);
  },
);

it('preserves an inherited second priority through an individual first-level override while another donor covers it', () => {
  const c = context([5, 5, 5], 'R2');
  const bulk = setDonorPriorityLevels(c, 'D', [['R1'], ['R2'], ['R3']]);
  const accepted = acceptSecondDonor({ ...c, proposal: bulk });
  const individual = setDonorPriorities(
    { ...c, proposal: bulk, accepted },
    'SKU',
    'D',
    [],
  );
  const next = setDonorSplitMode(
    {
      ...c,
      proposal: individual,
      accepted: revokeSecondDonor({ ...c, proposal: individual, accepted }),
    },
    'D',
    'EQUAL',
  );
  expect(tierQuantities(next)).toEqual([0, 5, 0, 0]);
  expect(
    next.allocationDecisions!.find((d) => d.fromBranchId === 'D')!.recipientIds,
  ).toEqual([]);
  expect(next.allocationPriorityLevels?.D).toEqual([['R1'], ['R2'], ['R3']]);
});

it('allows editing another individual flag while retaining a configured first-priority recipient covered by another donor', () => {
  const c = context([5, 5], 'R1');
  const accepted = acceptSecondDonor(c);
  const bulk = setDonorPriorityLevels({ ...c, accepted }, 'D', [
    ['R1'],
    ['R2'],
    [],
  ]);
  const individual = setDonorPriorities(
    { ...c, proposal: bulk, accepted },
    'SKU',
    'D',
    ['R1', 'R2'],
  );
  expect(tierQuantities(individual)).toEqual([0, 5, 0, 0]);
  expect(
    individual.allocationDecisions!.find((d) => d.fromBranchId === 'D')!
      .recipientIds,
  ).toEqual(['R1', 'R2']);
  expect(
    buildDonorAllocationModel({ ...c, proposal: individual, accepted }).find(
      (r) => r.fromBranchId === 'D',
    )!.individualPriority,
  ).toBe(true);
});
