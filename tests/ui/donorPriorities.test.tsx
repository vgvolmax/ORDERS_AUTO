import { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  StoreContext,
  type AppState,
  type StatePatch,
} from '../../src/app/appStore';
import {
  createProposal,
  prepareDonorPlanChange,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { createWorkspaceSession } from '../../src/app/workspaceSession';

function shortage() {
  const s = rebalanceAppState();
  s.minMax!.branchStocks.forEach((r, i) =>
    Object.assign(r, { stock: [66, 0, 0][i], min: 1, max: [60, 4, 8][i] }),
  );
  s.rebalance.proposal = createProposal(s);
  s.rebalance.tab = 'priorities';
  return s;
}
it('shows both split modes in the donor matrix, preserves manual quantities and rejects an overdraw', async () => {
  let current = shortage();
  function Harness() {
    const [state, setState] = useState(current);
    const set = (patch: StatePatch) => {
      current = {
        ...current,
        ...(typeof patch === 'function' ? patch(current) : patch),
      };
      setState(current);
    };
    return (
      <StoreContext.Provider
        value={{
          state,
          set,
          commit: async (patch) => {
            set(patch);
          },
        }}
      >
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Приоритеты Донор А' }));
  expect(
    screen.getByRole('dialog', { name: 'Приоритеты донора Донор А' }),
  ).toHaveTextContent('Нужны приоритеты');
  fireEvent.change(screen.getByLabelText('Распределение между выбранными'), {
    target: { value: 'EQUAL' },
  });
  await waitFor(() =>
    expect(current.rebalance.proposal!.allocationModes?.b0).toBe('EQUAL'),
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Приоритет SKU1 Донор Б' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Переместить SKU1 Донор Б')).toHaveValue(4),
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Приоритет SKU1 Получатель' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Переместить SKU1 Получатель')).toHaveValue(3),
  );
  expect(screen.getByLabelText('Переместить SKU1 Донор Б')).toHaveValue(3);
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
    target: { value: '4' },
  });
  await waitFor(() =>
    expect(
      screen.getByText(/Количество не сохранено: проверьте шаг/),
    ).toHaveTextContent('MAX'),
  );
  expect(screen.getByLabelText('Переместить SKU1 Получатель')).toHaveValue(3);
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
    target: { value: '2' },
  });
  await waitFor(() =>
    expect(current.rebalance.proposal!.allocationDecisions?.[0]?.mode).toBe(
      'MANUAL',
    ),
  );
  fireEvent.change(screen.getByLabelText('Распределение между выбранными'), {
    target: { value: 'PROPORTIONAL' },
  });
  await waitFor(() =>
    expect(current.rebalance.proposal!.allocationModes?.b0).toBe(
      'PROPORTIONAL',
    ),
  );
  expect(screen.getByLabelText('Переместить SKU1 Получатель')).toHaveValue(2);
  expect(screen.getByLabelText('Переместить SKU1 Донор Б')).toHaveValue(3);
  act(() => {
    fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
      target: { value: '3' },
    });
  });
  await waitFor(() =>
    expect(
      current.rebalance.proposal!.transfers.find((t) => t.toBranchId === 'b2')!
        .qty,
    ).toBe(3),
  );
  expect(
    screen.queryByText(/Количество не сохранено: проверьте шаг/),
  ).not.toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Готово' })),
  );
});
it('responds to a priority flag immediately while saving and restores it after a failed save', async () => {
  const initial = shortage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  render(
    <StoreContext.Provider
      value={{
        state: initial,
        set: () => undefined,
        commit: async () => {
          await gate;
          throw new Error('quota');
        },
      }}
    >
      <RebalancingPage />
    </StoreContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Приоритеты Донор А' }));
  const flag = screen.getByRole('checkbox', {
    name: 'Приоритет SKU1 Получатель',
  });
  fireEvent.click(flag);
  expect(flag).toBeChecked();
  expect(flag).toBeDisabled();
  expect(initial.rebalance.proposal!.allocationRevision).toBeUndefined();
  await act(async () => release());
  await waitFor(() => expect(flag).not.toBeChecked());
  expect(flag).toBeEnabled();
  expect(
    screen.getByRole('dialog', { name: 'Приоритеты донора Донор А' }),
  ).toHaveTextContent('Последняя правка не сохранена');
});
it('keeps draft edits outside purchase demand and clears selection when quantities change', () => {
  const s = shortage(),
    before = derive(s).purchaseDemand;
  s.rebalance.selectedLineIds = s.rebalance.proposal!.transfers.map(
    (t) => t.sourceLineId,
  );
  const expected = { runId: s.rebalance.proposal!.runId, acceptedRevision: 0 };
  const next: AppState = {
    ...s,
    ...prepareDonorPlanChange(
      s,
      {
        kind: 'priorities',
        skuCode: 'SKU1',
        fromBranchId: 'b0',
        recipientIds: ['b2'],
      },
      expected,
    ),
  };
  expect(derive(next).purchaseDemand).toEqual(before);
  expect(next.rebalance.selectedLineIds).toEqual([]);
  const id = next.rebalance.proposal!.transfers[0]!.sourceLineId;
  const accepted = {
    ...next,
    ...prepareAcceptedChange(next, {
      kind: 'accept',
      ids: [id],
      expectedRevision: 0,
    }).patch,
  };
  expect(accepted.rebalance.accepted[0]!.qty).toBe(6);
  expect(derive(accepted).purchaseDemand).not.toEqual(before);
  expect(() =>
    prepareDonorPlanChange(
      accepted,
      { kind: 'mode', fromBranchId: 'b0', mode: 'EQUAL' },
      expected,
    ),
  ).toThrow('REVISION_CONFLICT');
});
it('publishes a plan only after durable save, retries failure and rejects a command after acceptance', async () => {
  const initial = shortage(),
    expected = {
      runId: initial.rebalance.proposal!.runId,
      acceptedRevision: 0,
    };
  let failSave = true,
    published = 0;
  const session = createWorkspaceSession({
    initial,
    publish: () => {
      published++;
    },
    save: async () => {
      if (failSave) throw new Error('quota');
    },
  });
  const command = {
    kind: 'priorities' as const,
    skuCode: 'SKU1',
    fromBranchId: 'b0',
    recipientIds: ['b2'],
  };
  await expect(
    session.commit((s) => prepareDonorPlanChange(s, command, expected)),
  ).rejects.toThrow('quota');
  expect(session.getState().rebalance.proposal).toEqual(
    initial.rebalance.proposal,
  );
  expect(published).toBe(0);
  session.transient({
    toast: 'Изменения не сохранены. Предыдущая версия сеанса сохранена.',
  });
  failSave = false;
  await session.commit((s) => prepareDonorPlanChange(s, command, expected));
  expect(session.getState().rebalance.proposal!.allocationRevision).toBe(1);
  expect(published).toBe(2);
  expect(session.getState().toast).toBeNull();
  await session.commit(
    (s) =>
      prepareAcceptedChange(s, {
        kind: 'accept',
        ids: s.rebalance.proposal!.transfers.map((t) => t.sourceLineId),
        expectedRevision: 0,
      }).patch,
  );
  await expect(
    session.commit((s) => prepareDonorPlanChange(s, command, expected)),
  ).rejects.toThrow('REVISION_CONFLICT');
  expect(session.getState().rebalance.accepted[0]!.qty).toBe(6);
});
