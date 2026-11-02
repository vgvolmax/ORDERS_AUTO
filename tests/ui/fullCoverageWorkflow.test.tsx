import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createProposal } from '../../src/app/rebalanceActions';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { StoreContext } from '../../src/app/appStore';

it('removes all entrances to manual priorities and marks an older algorithm stale even with identical settings', () => {
  const state = rebalanceAppState();
  state.rebalance.proposal = {
    ...createProposal(state),
    algorithmVersion: 'legacy-partial',
  };
  state.rebalance.tab = 'results';
  render(
    <StoreContext.Provider value={{ state, set: () => undefined }}>
      <RebalancingPage />
    </StoreContext.Provider>,
  );
  expect(
    screen.queryByRole('tab', { name: 'Приоритеты' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Приоритеты отправлений/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Предложения устарели/)).toBeVisible();
});

it('opens skipped need from the dashboard and explains why trial flow was discarded', async () => {
  const { useState } = await import('react');
  const { fireEvent, within } = await import('@testing-library/react');
  const initial = rebalanceAppState();
  initial.minMax!.branchStocks[0]!.stock = 67;
  initial.minMax!.branchStocks[1]!.stock = 65;
  initial.minMax!.branchStocks[2]!.stock = 46;
  initial.minMax!.branchStocks[2]!.min = 50;
  initial.rebalance.proposal = createProposal(initial);
  initial.rebalance.tab = 'results';
  function Harness() {
    const [state, update] = useState(initial);
    return (
      <StoreContext.Provider
        value={{
          state,
          set: (p) =>
            update((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })),
        }}
      >
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  expect(
    screen.getByText('Не распределено', { selector: '.metric > span' })
      .parentElement,
  ).toHaveTextContent('14 шт');
  expect(
    screen.getByText('К перемещению', { selector: '.metric > span' })
      .parentElement,
  ).toHaveTextContent('0,00');
  fireEvent.click(screen.getByRole('button', { name: 'Показать список' }));
  const list = screen.getByRole('region', {
    name: 'Нераспределённые артикулы',
  });
  expect(list).toHaveTextContent('Нужно: 14');
  expect(list).toHaveTextContent('Можно доставить: 12');
  expect(list).toHaveTextContent('Не хватает: 2');
  expect(list).toHaveTextContent('1 400,00');
  fireEvent.click(
    within(list).getByRole('button', { name: /Потребность подразделений/ }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Не распределено · A1' });
  expect(dialog).toHaveTextContent('Получатель');
  expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole('group', {
      name: 'Итоги нераспределённого товара',
    }),
  ).toHaveTextContent('Нужно14');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Проверить маршруты' }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Маршруты' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

it('keeps accepted purchasing and revoke available after disabling its donor and reloading the state', async () => {
  const { useState } = await import('react');
  const { fireEvent, within, waitFor } = await import('@testing-library/react');
  const { prepareAcceptedChange } =
    await import('../../src/app/rebalanceActions');
  const { derive } = await import('../../src/app/selectors');
  const initial = rebalanceAppState();
  initial.rebalance.proposal = createProposal(initial);
  Object.assign(
    initial,
    prepareAcceptedChange(initial, {
      kind: 'accept',
      ids: [initial.rebalance.proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
  );
  initial.rebalance.tab = 'routes';
  let current = initial;
  function Harness() {
    const [state, update] = useState(initial);
    current = state;
    const set: (p: import('../../src/app/appStore').StatePatch) => void = (p) =>
      update((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
    return (
      <StoreContext.Provider
        value={{ state, set, commit: async (p) => set(p) }}
      >
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  const { unmount } = render(<Harness />);
  fireEvent.click(
    screen.getAllByRole('checkbox', { name: 'Участие Донор А' })[0]!,
  );
  await waitFor(() =>
    expect(current.rebalance.registry[0]!.active).toBe(false),
  );
  expect(
    derive(current).purchaseDemand.find((l) => l.branch === 'Получатель')!
      .purchaseQty,
  ).toBe(35);
  expect(screen.getByText(/Предложения устарели/)).toBeVisible();
  const { stateFromWorkspace, workspaceFromState } =
    await import('../../src/app/workspaceSession');
  const loaded = stateFromWorkspace(workspaceFromState(current));
  expect(loaded.rebalance.registry[0]!.active).toBe(false);
  unmount();
  initial.rebalance = loaded.rebalance;
  initial.rebalance.tab = 'results';
  render(<Harness />);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Открыть перемещение Донор А → Получатель',
    }),
  );
  const drawer = screen.getByRole('dialog', { name: 'Состав перемещения' });
  fireEvent.click(
    within(drawer).getByRole('button', { name: /Отменить принятие SKU1/ }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Отменить принятие перемещения' }),
    ).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(current.rebalance.accepted).toHaveLength(0));
  expect(
    derive(current).purchaseDemand.find((l) => l.branch === 'Получатель')!
      .purchaseQty,
  ).toBe(50);
});

it('keeps the result search name stable while typing and clearing', async () => {
  const { useState } = await import('react');
  const { fireEvent } = await import('@testing-library/react');
  const initial = rebalanceAppState();
  initial.rebalance.proposal = createProposal(initial);
  initial.rebalance.tab = 'results';
  function Harness() {
    const [state, set] = useState(initial);
    return (
      <StoreContext.Provider
        value={{
          state,
          set: (p) =>
            set((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })),
        }}
      >
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  const name = 'Поиск по коду, артикулу, товару и маршруту';
  fireEvent.change(screen.getByRole('textbox', { name }), {
    target: { value: 'SKU1' },
  });
  expect(screen.getByRole('textbox', { name })).toHaveValue('SKU1');
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(screen.getByRole('textbox', { name })).toHaveValue('');
  expect(screen.getByRole('textbox', { name })).toHaveFocus();
});

it('treats a negative raw price as unknown consistently in skipped details', async () => {
  const { SkippedRebalanceList } =
    await import('../../src/features/rebalancing/SkippedRebalanceList');
  const initial = rebalanceAppState();
  const proposal = {
    ...createProposal(initial),
    skippedSkus: [
      {
        skuCode: 'SKU1',
        neededQty: 14,
        deliverableQty: 12,
        missingQty: 2,
        reason: 'INSUFFICIENT_SURPLUS' as const,
        recipients: [],
      },
    ],
  };
  render(
    <SkippedRebalanceList
      proposal={proposal}
      skus={[{ ...initial.minMax!.skus[0]!, referencePrice: -10 }]}
      registry={initial.rebalance.registry}
      policies={initial.rebalance.policies}
      stale={false}
      onBack={() => undefined}
    />,
  );
  expect(screen.getByText('Сумма неизвестна')).toBeVisible();
  expect(screen.queryByText(/−?[-]140,00/)).not.toBeInTheDocument();
});
