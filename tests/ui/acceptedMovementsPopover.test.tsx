import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AcceptedMovementsPopover } from '../../src/features/rebalancing/AcceptedMovementsPopover';
import { buildMovementSummary } from '../../src/domain/rebalancing';
import { derive } from '../../src/app/selectors';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
it('only displays supplied summary and returns to the rebalancing workspace on explicit action', () => {
  const state = rebalanceAppState(),
    navigate = vi.fn(),
    close = vi.fn();
  const summary = buildMovementSummary({
    purchaseDemand: derive(state).purchaseDemand,
    acceptedTransfers: [],
    registry: state.rebalance.registry,
    policies: state.rebalance.policies,
    scope: { branchId: 'b2' },
  });
  const before = structuredClone(state);
  render(
    <AcceptedMovementsPopover
      summary={summary}
      onOpenRebalancing={navigate}
      onClose={close}
    />,
  );
  expect(screen.getByText('Без перемещений')).toBeVisible();
  expect(state).toEqual(before);
  fireEvent.click(
    screen.getByRole('button', { name: 'Открыть ребалансировку' }),
  );
  expect(navigate).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
