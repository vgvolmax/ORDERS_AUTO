import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext, type StatePatch } from '../../src/app/appStore';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it.each([
  ['unitPriceFilter', 'Порог цены', 1000],
  ['skuAmountFilter', 'Порог суммы SKU', 10000],
] as const)(
  'rolls back the visible %s threshold after a failed write and supports retry',
  async (key, label, original) => {
    const initial = rebalanceAppState();
    initial.rebalance.tab = 'conditions';
    let fail = true;
    let session!: ReturnType<typeof createWorkspaceSession>;
    function Harness() {
      const [state, publish] = useState(initial);
      const ref = useRef<ReturnType<typeof createWorkspaceSession> | null>(
        null,
      );
      if (!ref.current)
        ref.current = createWorkspaceSession({
          initial,
          publish,
          save: async () => {
            if (fail) throw new Error('quota');
          },
        });
      session = ref.current;
      const commit = (patch: StatePatch) => session.commit(patch);
      return (
        <StoreContext.Provider
          value={{
            state,
            commit,
            set: (patch) => {
              void commit(patch).catch(() => undefined);
            },
          }}
        >
          <RebalancingPage />
        </StoreContext.Provider>
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveValue(original));
    expect(session.getState().rebalance.config[key].threshold).toBe(original);
    expect(screen.getByRole('alert')).toHaveTextContent('Порог не сохранён');
    fail = false;
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(session.getState().rebalance.config[key].threshold).toBe(5000),
    );
    expect(input).toHaveValue(5000);
  },
);

it('keeps a pending threshold when another condition changes before the save finishes', async () => {
  const initial = rebalanceAppState();
  initial.rebalance.tab = 'conditions';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let session!: ReturnType<typeof createWorkspaceSession>;
  function Harness() {
    const [state, publish] = useState(initial);
    const ref = useRef<ReturnType<typeof createWorkspaceSession> | null>(null);
    if (!ref.current)
      ref.current = createWorkspaceSession({
        initial,
        publish,
        save: () => gate,
      });
    session = ref.current;
    return (
      <StoreContext.Provider
        value={{
          state,
          commit: session.commit,
          set: (patch) => {
            void session.commit(patch);
          },
        }}
      >
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Порог цены'), {
    target: { value: '5000' },
  });
  fireEvent.change(screen.getByLabelText('Получатель'), {
    target: { value: 'BELOW_MAX' },
  });
  release();
  await waitFor(() =>
    expect(session.getState().rebalance.config.recipientTrigger).toBe(
      'BELOW_MAX',
    ),
  );
  expect(session.getState().rebalance.config.unitPriceFilter.threshold).toBe(
    5000,
  );
  expect(screen.getByLabelText('Порог цены')).toHaveValue(5000);
});
