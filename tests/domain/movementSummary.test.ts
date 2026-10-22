import { expect, it } from 'vitest';
import { buildMovementSummary } from '../../src/domain/rebalancing/movementSummary';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
it('summarizes only accepted transfers, deduplicates aggregate scope and keeps manual order separate', () => {
  let state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'accept',
      ids: [state.rebalance.proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
  const input = {
    purchaseDemand: derive(state).purchaseDemand,
    acceptedTransfers: state.rebalance.accepted,
    registry: state.rebalance.registry,
    policies: state.rebalance.policies,
  };
  const summary = buildMovementSummary({
    ...input,
    scope: { skuCode: 'SKU1', branchId: 'b2' },
    manualOrderQty: 40,
  });
  expect(summary).toMatchObject({
    originalNeed: 50,
    currentNeed: 35,
    incomingQty: 15,
    outgoingQty: 0,
    transferCount: 1,
    manualOrderQty: 40,
  });
  expect(buildMovementSummary({ ...input, scope: {} }).transferCount).toBe(1);
  expect(
    buildMovementSummary({ ...input, scope: { branchId: 'b0' } }),
  ).toMatchObject({ incomingQty: 0, outgoingQty: 15, currentNeed: 0 });
});
it('does not sum incompatible or unknown units into one physical quantity', () => {
  const state = rebalanceAppState(),
    demand = derive(state).purchaseDemand;
  const summary = buildMovementSummary({
    purchaseDemand: [
      ...demand,
      ...demand.map((d) => ({ ...d, skuCode: 'SKU2' })),
    ],
    acceptedTransfers: [],
    registry: state.rebalance.registry,
    policies: [
      ...state.rebalance.policies,
      { skuCode: 'SKU2', unit: 'кг', quantityStep: 0.1 },
    ],
    scope: {},
  });
  expect(summary.currentNeed).toBeNull();
  expect(summary.totalsByUnit).toHaveLength(2);
});
