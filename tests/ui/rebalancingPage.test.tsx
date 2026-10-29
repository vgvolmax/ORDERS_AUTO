import { StoreContext } from '../../src/app/appStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { renderWithStore } from './renderWithStore';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
it('offers recipient settings, explicit quantity policies and mirrored direct routes without a donor slider', () => {
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

it('does not invent quantity policies and explicitly assigns the operators unit and step', () => {
  const state = rebalanceAppState();
  state.rebalance.policies = [];
  const patches: unknown[] = [];
  renderWithStore(<RebalancingPage />, state, (p) =>
    patches.push(typeof p === 'function' ? p(state) : p),
  );
  expect(screen.getByLabelText('Единица SKU1')).toHaveValue('');
  expect(screen.getByLabelText('Шаг SKU1')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Единица для ненастроенных SKU'), {
    target: { value: 'кг' },
  });
  fireEvent.change(screen.getByLabelText('Шаг для ненастроенных SKU'), {
    target: { value: '0.25' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Назначить ненастроенным (1)' }),
  );
  expect(patches).toContainEqual(
    expect.objectContaining({
      rebalance: expect.objectContaining({
        policies: [{ skuCode: 'SKU1', unit: 'кг', quantityStep: 0.25 }],
      }),
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
