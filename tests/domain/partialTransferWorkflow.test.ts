import { expect, it } from 'vitest';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import type { AppState } from '../../src/app/appStore';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it('reduces purchasing only after accepting a partial movement and restores it on revoke', () => {
  const state = rebalanceAppState();
  state.minMax!.branchStocks[0]!.stock = 75; // 15 above Max
  state.minMax!.branchStocks[1]!.stock = 60; // no other donor surplus
  state.rebalance.config.transferAmountFilter = { enabled: true, threshold: 1100 };

  const proposal = createProposal(state);
  expect(proposal.transfers.map((t) => [t.fromBranchId, t.toBranchId, t.qty]))
    .toEqual([['b0', 'b2', 15]]);
  expect(proposal.uncoveredNeed).toContainEqual({
    skuCode: 'SKU1', branchId: 'b2', toMin: 0, toTarget: 35,
  });

  const proposedState: AppState = {
    ...state,
    rebalance: { ...state.rebalance, proposal },
  };
  const need = (current: AppState) =>
    derive(current).purchaseDemand.find((line) => line.branch === 'Получатель')!.purchaseQty;
  const ordered = (current: typeof proposedState) =>
    derive(current).projection.orders
      .find((order) => order.branch === 'Получатель')!.lines[0]!.orderQty;

  expect(need(proposedState)).toBe(50);
  expect(ordered(proposedState)).toBe(50);
  const accepted = {
    ...proposedState,
    ...prepareAcceptedChange(proposedState, {
      kind: 'accept',
      ids: [proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
  expect(need(accepted)).toBe(35);
  expect(ordered(accepted)).toBe(35);
  const revoked = {
    ...accepted,
    ...prepareAcceptedChange(accepted, {
      kind: 'revoke',
      ids: accepted.rebalance.accepted.map((t) => t.transferId),
      expectedRevision: 1,
    }).patch,
  };
  expect(need(revoked)).toBe(50);
  expect(ordered(revoked)).toBe(50);
});
