import { StoreContext } from '../../src/app/appStore';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { renderWithStore } from './renderWithStore';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
it('allows calculating transfers with MIN/MAX and a JSON catalog without the old supplier report', () => {
  const state = rebalanceAppState();
  state.catalog = createSupplierCatalog(state);
  state.suppliers = null;
  renderWithStore(<RebalancingPage />, state);
  expect(screen.getByRole('button', { name: 'Рассчитать перемещения' })).toBeEnabled();
});
it('identifies both ends of an excluded transfer document', async () => {
  const { createProposal } = await import('../../src/app/rebalanceActions');
  const state = rebalanceAppState();
  state.rebalance.config.transferAmountFilter = {
    enabled: true,
    threshold: 6000,
  }; // This receiver needs50×100=5000.
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  renderWithStore(<RebalancingPage />, state);
  fireEvent.click(screen.getByText(/Исключения и проверки данных/));
  const reason = screen.getAllByText('Сумма SKU в перемещении ниже порога')[0]!;
  const row = reason.closest('[role="row"]')!;
  expect(
    within(row as HTMLElement).getByText('Донор А → Получатель', {
      exact: true,
    }),
  ).toBeVisible();
});
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

it('shows saved per-SKU route diagnostics without summing a different SKU', () => {
  const state = rebalanceAppState();
  state.rebalance.tab = 'results';
  state.rebalance.accepted = [
    {
      transferId: 'retained',
      sourceRunId: 'run',
      sourceLineId: 'line',
      skuCode: 'SKU1',
      fromBranchId: 'b0',
      toBranchId: 'b2',
      qty: 10,
      snapshotId: state.snapshotId,
      acceptedAt: '2026-11-03T09:00:00Z',
      acceptedConfig: {
        ...state.rebalance.config,
        transferAmountFilter: { enabled: true, threshold: 5000 },
      },
    },
  ];
  state.rebalance.acceptedRevision = 1;
  renderWithStore(<RebalancingPage />, state);
  expect(
    screen.getByText(/Оставшаяся сумма SKU в принятом перемещении/),
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
