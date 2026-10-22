import { useRef, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext, type StatePatch } from '../../src/app/appStore';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import { createProposal } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it.each([false, true])(
  'accept click waits for pending selection persistence; failed selection=%s',
  async (failSelection) => {
    const initial = rebalanceAppState();
    initial.rebalance.proposal = createProposal(initial);
    initial.rebalance.tab = 'results';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saves = 0;
    let session!: ReturnType<typeof createWorkspaceSession>;
    function Harness() {
      const [state, publish] = useState(initial);
      const [pending, setPending] = useState(0);
      const ref = useRef<ReturnType<typeof createWorkspaceSession> | null>(
        null,
      );
      if (!ref.current)
        ref.current = createWorkspaceSession({
          initial,
          publish,
          save: async () => {
            if (++saves === 1) {
              await gate;
              if (failSelection) throw new Error('quota');
            }
          },
        });
      session = ref.current;
      const commit = async (patch: StatePatch) => {
        setPending((n) => n + 1);
        try {
          await session.commit(patch);
        } finally {
          setPending((n) => n - 1);
        }
      };
      return (
        <StoreContext.Provider
          value={{
            state,
            saving: pending > 0,
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
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Открыть перемещение Донор А → Получатель',
      }),
    );
    const drawer = screen.getByRole('dialog', { name: 'Состав перемещения' });
    fireEvent.click(
      within(drawer).getByRole('checkbox', {
        name: /Выбрать перемещение SKU1/,
      }),
    );
    await waitFor(() => expect(saves).toBe(1));
    const accept = within(drawer).getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
    });
    expect(accept).toBeEnabled();
    expect(session.getState().rebalance.accepted).toEqual([]);
    expect(session.getState().rebalance.rejectedLineIds).toEqual([]);
    fireEvent.click(accept);
    expect(
      screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).not.toBeInTheDocument();
    await act(async () => release());
    if (failSelection) {
      await waitFor(() =>
        expect(within(drawer).getByText(/Выбор не сохранён/)).toBeVisible(),
      );
      expect(session.getState().rebalance.accepted).toEqual([]);
      expect(
        screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
      ).not.toBeInTheDocument();
    } else {
      const dialog = await screen.findByRole('dialog', {
        name: 'Принять выбранные перемещения',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Принять перемещения' }),
      );
      await waitFor(() =>
        expect(session.getState().rebalance.accepted).toHaveLength(1),
      );
      expect(
        derive(session.getState()).purchaseDemand.find(
          (line) => line.branch === 'Получатель',
        )!.purchaseQty,
      ).toBe(35);
      expect(session.getState().rebalance.rejectedLineIds).toEqual([]);
      expect(screen.queryByText(/Решения изменились/)).not.toBeInTheDocument();
    }
  },
);
