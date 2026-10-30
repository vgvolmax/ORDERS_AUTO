import { StoreContext } from '../../src/app/appStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { renderWithStore } from './renderWithStore';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
it('offers recipient settings, automatic whole-unit quantities and mirrored direct routes without a donor slider', () => {
  const state = rebalanceAppState();
  const patches: unknown[] = [];
  renderWithStore(
    <RebalancingPage />,
    state,
    vi.fn((p) => patches.push(typeof p === 'function' ? p(state) : p)),
  );
  expect(screen.getByLabelText('Получатель')).toHaveValue('BELOW_MIN');
  expect(screen.getAllByRole('slider')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Получатель'), {
    target: { value: 'BELOW_MAX' },
  });
  expect(patches).toContainEqual(
    expect.objectContaining({
      rebalance: expect.objectContaining({
        config: expect.objectContaining({ recipientTrigger: 'BELOW_MAX' }),
      }),
    }),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Маршруты' }));
  // Test store does not rerender automatically; the durable tab change is itself asserted.
  expect(patches).toContainEqual(
    expect.objectContaining({
      rebalance: expect.objectContaining({ tab: 'routes' }),
    }),
  );
});

it('shows saved economic diagnostics immediately after a partial revocation', async () => {
  const { createProposal, prepareAcceptedChange } = await import(
    '../../src/app/rebalanceActions'
  );
  let state = rebalanceAppState();
  state.rebalance.config.skuAmountFilter = { enabled: true, threshold: 1500 };
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'accept',
      ids: state.rebalance.proposal.transfers.map((t) => t.sourceLineId),
      expectedRevision: 0,
    }).patch,
  };
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'revoke',
      ids: [state.rebalance.accepted[1]!.transferId],
      expectedRevision: 1,
    }).patch,
  };
  renderWithStore(<RebalancingPage />, state);
  expect(
    screen.getByText(/Оставшаяся сумма принятых перемещений/),
  ).toBeInTheDocument();
});

it('keeps settings focused and responsive while saves are pending, without enabling calculation', async () => {
  const state = rebalanceAppState();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  render(
    <StoreContext.Provider
      value={{
        state,
        set: () => undefined,
        saving: true,
        commit: async () => gate,
      }}
    >
      <RebalancingPage />
    </StoreContext.Provider>,
  );
  const slider = screen.getByRole('slider');
  slider.focus();
  fireEvent.change(slider, { target: { value: '20' } });
  fireEvent.change(slider, { target: { value: '80' } });
  expect(slider).toHaveValue('80');
  expect(slider).toBeEnabled();
  expect(slider).toHaveFocus();
  expect(state.rebalance.config.receiverPct).toBe(100);
  expect(
    screen.getByRole('button', { name: 'Рассчитать перемещения' }),
  ).toBeDisabled();
  await act(async () => finish());
});
