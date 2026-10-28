import { expect, it } from 'vitest';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import {
  createProposal,
  prepareDonorPlanChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import {
  workspaceFromState,
  stateFromWorkspace,
} from '../../src/app/workspaceSession';
import { saveWorkspace, loadWorkspace } from '../../src/persistence/workspaces';

it('persists bulk decisions and template without changing orders, and rejects stale commands', async () => {
  const s = rebalanceAppState();
  s.workspaceRevision = 0;
  s.rebalance.proposal = createProposal(s);
  const before = derive(s).purchaseDemand,
    expected = { runId: s.rebalance.proposal.runId, acceptedRevision: 0 };
  const command = {
    kind: 'levels' as const,
    fromBranchId: 'b0',
    levels: [['b2'], [], []] as [string[], string[], string[]],
    overwriteManual: false,
  };
  const patch = prepareDonorPlanChange(s, command, expected),
    next = { ...s, ...patch };
  expect(next.rebalance.proposal!.allocationPriorityLevels?.b0).toEqual([
    ['b2'],
    [],
    [],
  ]);
  expect(derive(next).purchaseDemand).toEqual(before);
  const stored = workspaceFromState(next);
  await saveWorkspace(stored, -1);
  const restored = stateFromWorkspace((await loadWorkspace(s.workspaceId))!);
  expect(restored.rebalance.proposal).toEqual(next.rebalance.proposal);
  expect(() =>
    prepareDonorPlanChange(next, command, { ...expected, runId: 'old' }),
  ).toThrow('STALE_PROPOSAL');
  expect(() =>
    prepareDonorPlanChange(next, command, { ...expected, acceptedRevision: 5 }),
  ).toThrow('REVISION_CONFLICT');
});
