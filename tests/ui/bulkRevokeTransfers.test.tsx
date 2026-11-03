import { useState } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  StoreContext,
  type AppState,
  type StatePatch,
} from '../../src/app/appStore';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

function acceptedState() {
  let s = rebalanceAppState();
  s.minMax!.skus.push({
    ...s.minMax!.skus[0]!,
    code: 'SKU2',
    name: 'Второй товар',
  });
  s.minMax!.branchStocks.push(
    ...s.minMax!.branchStocks.map((r) => ({ ...r, skuCode: 'SKU2' })),
  );
  s.rebalance.policies.push({ skuCode: 'SKU2', unit: 'шт', quantityStep: 1 });
  s.rebalance.proposal = createProposal(s);
  s = {
    ...s,
    ...prepareAcceptedChange(s, {
      kind: 'accept',
      ids: s.rebalance.proposal.transfers.map((t) => t.sourceLineId),
      expectedRevision: 0,
    }).patch,
  };
  s.rebalance.tab = 'results';
  return s;
}
function harness(initial = acceptedState()) {
  let current: AppState = initial,
    fail = false;
  function Harness() {
    const [state, update] = useState(initial);
    current = state;
    const set = (patch: StatePatch) =>
      update((s) => ({
        ...s,
        ...(typeof patch === 'function' ? patch(s) : patch),
      }));
    const commit = async (patch: StatePatch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (
        fail &&
        next.rebalance?.acceptedRevision !== state.rebalance.acceptedRevision
      ) {
        fail = false;
        throw new Error('Не удалось сохранить отмену');
      }
      set(next);
    };
    return (
      <StoreContext.Provider value={{ state, set, commit }}>
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  return {
    current: () => current,
    failNext: () => {
      fail = true;
    },
  };
}
const confirmation = () =>
  screen.getByRole('dialog', { name: /^Отменить принятие перемещени/ });

it('selects accepted rows by SKU search without changing other SKUs or proposal selections', async () => {
  const h = harness();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Открыть перемещение Донор А → Получатель',
    }),
  );
  const drawer = screen.getByRole('dialog', { name: 'Состав перемещения' });
  fireEvent.click(
    within(drawer).getByLabelText('Выбрать все принятые по поиску'),
  );
  fireEvent.change(
    within(drawer).getByLabelText('Поиск по составу перемещения'),
    { target: { value: 'SKU1' } },
  );
  expect(
    within(drawer).getByText(/Скрыто поиском: 1; в отмену не попадут/),
  ).toBeVisible();
  fireEvent.click(
    within(drawer).getByRole('button', {
      name: 'Отменить выбранные принятые (1)',
    }),
  );
  expect(h.current().rebalance.accepted).toHaveLength(4);
  fireEvent.click(
    within(confirmation()).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(h.current().rebalance.accepted).toHaveLength(3));
  expect(
    h.current().rebalance.accepted.filter((t) => t.skuCode === 'SKU2'),
  ).toHaveLength(2);
  expect(h.current().rebalance.selectedLineIds).toEqual([]);
  expect(
    derive(h.current()).purchaseDemand.find(
      (l) => l.skuCode === 'SKU1' && l.branch === 'Получатель',
    )!.purchaseQty,
  ).toBe(15);
});

it('revokes whole accepted directions selected by donor filter and leaves other donors untouched', async () => {
  const s = acceptedState();
  s.rebalance.tab = 'accepted';
  const h = harness(s);
  fireEvent.change(screen.getByLabelText('Отправитель принятых'), {
    target: { value: 'b0' },
  });
  fireEvent.click(screen.getByLabelText('Выбрать все направления по фильтрам'));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Отменить принятие выбранных направлений (1)',
    }),
  );
  expect(h.current().rebalance.accepted).toHaveLength(4);
  fireEvent.click(
    within(confirmation()).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(h.current().rebalance.accepted).toHaveLength(2));
  expect(
    h.current().rebalance.accepted.every((t) => t.fromBranchId === 'b1'),
  ).toBe(true);
});

it('keeps all accepted movements after failed bulk persistence and supports retry in the same confirmation', async () => {
  const s = acceptedState();
  s.rebalance.tab = 'accepted';
  const h = harness(s);
  fireEvent.click(screen.getByLabelText('Выбрать все направления по фильтрам'));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Отменить принятие выбранных направлений (2)',
    }),
  );
  h.failNext();
  fireEvent.click(
    within(confirmation()).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() =>
    expect(within(confirmation()).getByRole('alert')).toHaveTextContent(
      'Не удалось сохранить отмену',
    ),
  );
  expect(h.current().rebalance.accepted).toHaveLength(4);
  expect(h.current().rebalance.acceptedRevision).toBe(1);
  fireEvent.click(
    within(confirmation()).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(h.current().rebalance.accepted).toEqual([]));
  expect(h.current().rebalance.acceptedRevision).toBe(2);
});

it('allows revocation with a stale proposal and keeps a vanished last-route drawer until confirmation closes', async () => {
  const s = acceptedState();
  s.rebalance.accepted = s.rebalance.accepted.slice(0, 1);
  s.rebalance.proposal!.algorithmVersion = 'legacy';
  s.rebalance.tab = 'accepted';
  const h = harness(s);
  fireEvent.click(
    screen.getByRole('button', { name: 'Состав Донор А → Получатель' }),
  );
  const drawer = screen.getByRole('dialog', {
    name: 'Принято: Донор А → Получатель',
  });
  fireEvent.click(
    within(drawer).getByLabelText('Выбрать все принятые по поиску'),
  );
  fireEvent.click(
    within(drawer).getByRole('button', {
      name: 'Отменить выбранные принятые (1)',
    }),
  );
  fireEvent.click(
    within(confirmation()).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(h.current().rebalance.accepted).toEqual([]));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: /^Отменить принятие перемещени/ }),
    ).not.toBeInTheDocument(),
  );
  expect(
    within(drawer).getByText('В этом направлении больше нет позиций.'),
  ).toBeVisible();
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Закрыть карточку' }),
  );
  expect(screen.getByText(/Принятых перемещений пока нет/)).toBeVisible();
});
