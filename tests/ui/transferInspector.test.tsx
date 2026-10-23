import { useState } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import * as downloads from '../../src/export/download';
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

function initialState() {
  const state = rebalanceAppState();
  state.minMax!.skus.push({
    code: '00001',
    article: 'PPR-20',
    name: 'Труба в метрах',
    referencePrice: null,
    reportedTotalStock: null,
  });
  state.minMax!.branchStocks.push(
    ...state.minMax!.branches.map((branch, i) => ({
      skuCode: '00001',
      branch,
      stock: [62.5, 60, 10][i]!,
      min: 20,
      max: 60,
    })),
  );
  state.rebalance.policies.push({
    skuCode: '00001',
    unit: 'м',
    quantityStep: 0.25,
  });
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  return state;
}
function harness(initial = initialState(), failAcceptance = false) {
  let current: AppState = initial;
  function Harness() {
    const [state, update] = useState(initial);
    current = state;
    const set = (patch: StatePatch) =>
      update((s) => ({
        ...s,
        ...(typeof patch === 'function' ? patch(s) : patch),
      }));
    const commit = async (patch: StatePatch) => {
      const result = typeof patch === 'function' ? patch(state) : patch;
      if (failAcceptance && result.rebalance?.accepted.length)
        throw new Error('Не удалось сохранить сеанс');
      set(result);
    };
    return (
      <StoreContext.Provider value={{ state, set, commit }}>
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  return () => current;
}
const openRoute = (from = 'Донор А') => {
  const trigger = screen.getByRole('button', {
    name: 'Открыть перемещение ' + from + ' → Получатель',
  });
  fireEvent.click(trigger);
  return {
    trigger,
    drawer: screen.getByRole('dialog', { name: 'Состав перемещения' }),
  };
};
it('shows global and route amounts, keeps selection separate from rejection and updates the accepted amount', async () => {
  const state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  const current = harness(state);
  const metric = (label: string) => screen.getByText(label).parentElement!;
  expect(metric('Сумма перемещений')).toHaveTextContent('3 500,00');
  expect(metric('Принято на сумму')).toHaveTextContent('0,00');
  const { drawer } = openRoute();
  expect(within(drawer).getByLabelText('Сумма перемещения')).toHaveTextContent(
    '1 500,00',
  );
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение SKU1/ }),
  );
  expect(drawer).toHaveTextContent('Выбрано к принятию: 1');
  expect(current().rebalance.rejectedLineIds).toEqual([]);
  expect(current().rebalance.accepted).toEqual([]);
  fireEvent.click(
    within(drawer).getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
    }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() => expect(current().rebalance.accepted).toHaveLength(1));
  expect(metric('Сумма перемещений')).toHaveTextContent('3 500,00');
  expect(metric('Принято на сумму')).toHaveTextContent('1 500,00');
  expect(
    within(drawer).getByLabelText('Принято на сумму в перемещении'),
  ).toHaveTextContent('1 500,00');
});
it('opens a route document with product identity, exact units and both stock previews without quantity editing', () => {
  const current = harness();
  const original = structuredClone(current());
  const cell = screen.getByRole('button', {
    name: 'Открыть перемещение Донор А → Получатель',
  });
  expect(cell).toHaveTextContent('2 SKU');
  expect(cell).toHaveTextContent('Сумма неизвестна');
  expect(cell).toHaveTextContent('15 шт');
  expect(cell).toHaveTextContent('2,5 м');
  const { drawer } = openRoute();
  expect(drawer).toHaveTextContent('A1');
  expect(drawer).toHaveTextContent('Товар для перемещения');
  expect(drawer).toHaveTextContent('PPR-20');
  expect(drawer).toHaveTextContent('Труба в метрах');
  const piece = within(drawer)
    .getAllByRole('row')
    .find((row) => row.textContent?.includes('SKU1'))!;
  expect(piece).toHaveTextContent('75 → 60');
  expect(piece).toHaveTextContent('10 → 25');
  expect(piece).toHaveTextContent('MIN 20 · MAX 60');
  expect(within(drawer).queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(current()).toEqual(original);
});
it('closes the inspector with Escape and restores keyboard focus to the route cell', () => {
  harness();
  const trigger = screen.getByRole('button', {
    name: 'Открыть перемещение Донор А → Получатель',
  });
  trigger.focus();
  openRoute();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('accepts only selected positions in the open route and leaves another route selected and unapplied', async () => {
  const state = initialState();
  const other = state.rebalance.proposal!.transfers.find(
    (line) => line.fromBranchId === 'b1',
  )!;
  state.rebalance.selectedLineIds = [other.sourceLineId];
  const current = harness(state);
  const { drawer } = openRoute();
  fireEvent.click(
    within(drawer).getByRole('checkbox', {
      name: 'Выбрать видимые предложения',
    }),
  );
  expect(current().rebalance.accepted).toHaveLength(0);
  const accept = () => {
    const button = within(drawer).getByRole('button', {
      name: 'Принять выбранные в перемещении (2)',
    });
    button.focus();
    fireEvent.click(button);
  };
  accept();
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Отмена' }),
  );
  expect(current().rebalance.accepted).toHaveLength(0);
  expect(drawer).toBeVisible();
  accept();
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() => expect(current().rebalance.accepted).toHaveLength(2));
  expect(
    current().rebalance.accepted.every((line) => line.fromBranchId === 'b0'),
  ).toBe(true);
  expect(current().rebalance.selectedLineIds).toEqual([other.sourceLineId]);
  expect(
    derive(current()).purchaseDemand.find(
      (line) => line.skuCode === 'SKU1' && line.branch === 'Получатель',
    )!.purchaseQty,
  ).toBe(35);
  expect(within(drawer).getAllByText('Принято')).toHaveLength(2);
  expect(screen.getByText('Предложено строк').parentElement).toHaveTextContent(
    '1',
  );
  expect(drawer).toContainElement(document.activeElement as HTMLElement);
  expect(within(drawer).getByText('75 → 60')).toBeVisible();
  expect(within(drawer).getByText('10 → 25')).toBeVisible();
  fireEvent.click(
    within(drawer).getByRole('button', { name: /Отменить принятие SKU1/ }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Отменить принятие перемещения' }),
    ).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(current().rebalance.accepted).toHaveLength(1));
  expect(
    derive(current()).purchaseDemand.find(
      (line) => line.skuCode === 'SKU1' && line.branch === 'Получатель',
    )!.purchaseQty,
  ).toBe(50);
});
it('rejects and returns a position inside the document without changing purchasing quantities', () => {
  const current = harness();
  const before = derive(current()).purchaseDemand;
  const { drawer } = openRoute();
  const piece = () =>
    within(drawer)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('SKU1'))!;
  fireEvent.click(within(piece()).getByRole('checkbox'));
  fireEvent.click(within(piece()).getByRole('button', { name: 'Отклонить' }));
  expect(piece()).toHaveTextContent('Отклонено');
  expect(within(piece()).getByRole('checkbox')).toBeDisabled();
  expect(current().rebalance.selectedLineIds).toHaveLength(0);
  fireEvent.click(within(piece()).getByRole('button', { name: 'Вернуть' }));
  expect(within(piece()).getByRole('checkbox')).toBeEnabled();
  expect(derive(current()).purchaseDemand).toEqual(before);
});
it('keeps the document and committed purchase quantities when acceptance cannot be saved', async () => {
  const current = harness(initialState(), true);
  const before = derive(current()).purchaseDemand;
  const { drawer } = openRoute();
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение SKU1/ }),
  );
  fireEvent.click(
    within(drawer).getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
    }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Принять перемещения' }),
  );
  expect(await screen.findByText('Не удалось сохранить сеанс')).toBeVisible();
  expect(current().rebalance.accepted).toHaveLength(0);
  expect(derive(current()).purchaseDemand).toEqual(before);
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Отмена' }),
  );
  expect(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение SKU1/ }),
  ).toBeChecked();
});

it('limits acceptance to the currently visible positions and preserves hidden selections in the same document', async () => {
  const current = harness();
  const { drawer } = openRoute();
  fireEvent.click(
    within(drawer).getByRole('checkbox', {
      name: 'Выбрать видимые предложения',
    }),
  );
  fireEvent.change(
    within(drawer).getByRole('textbox', {
      name: 'Поиск по составу перемещения',
    }),
    { target: { value: 'A1' } },
  );
  expect(
    within(drawer).getAllByRole('checkbox', { name: /Выбрать перемещение/ }),
  ).toHaveLength(1);
  fireEvent.click(
    within(drawer).getByRole('button', {
      name: 'Принять выбранные в перемещении (1)',
    }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() => expect(current().rebalance.accepted).toHaveLength(1));
  expect(current().rebalance.accepted[0]!.skuCode).toBe('SKU1');
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Очистить поиск' }),
  );
  expect(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение 00001/ }),
  ).toBeChecked();
  expect(
    within(drawer).getByRole('textbox', {
      name: 'Поиск по составу перемещения',
    }),
  ).toHaveFocus();
});

it('allows inspecting an outdated proposal but disables selecting and accepting its positions', () => {
  const state = initialState();
  state.rebalance.config.receiverPct = 95;
  const current = harness(state);
  const { drawer } = openRoute();
  expect(drawer).toHaveTextContent('Предложения устарели');
  for (const checkbox of within(drawer).getAllByRole('checkbox'))
    expect(checkbox).toBeDisabled();
  expect(
    within(drawer).getByRole('button', {
      name: /Принять выбранные в перемещении/,
    }),
  ).toBeDisabled();
  expect(current().rebalance.accepted).toHaveLength(0);
});

it('pages a large route, preserves cross-page selection and searches the entire composition', () => {
  const state = rebalanceAppState();
  const sku = state.minMax!.skus[0]!;
  const stocks = state.minMax!.branchStocks;
  state.minMax!.skus = Array.from({ length: 500 }, (_, i) => ({
    ...sku,
    code: `SKU${i + 1}`,
    name: `Товар ${i + 1}`,
  }));
  state.minMax!.branchStocks = state.minMax!.skus.flatMap((s) =>
    stocks.map((line) => ({ ...line, skuCode: s.code })),
  );
  state.rebalance.policies = state.minMax!.skus.map((s) => ({
    skuCode: s.code,
    unit: 'шт',
    quantityStep: 1,
  }));
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  harness(state);
  const { drawer } = openRoute();
  expect(drawer).toHaveTextContent('500 SKU');
  expect(within(drawer).getAllByRole('row')).toHaveLength(4);
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение SKU1 / }),
  );
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Следующая страница' }),
  );
  expect(
    within(drawer).queryByRole('checkbox', {
      name: /Выбрать перемещение SKU1 /,
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение SKU4 / }),
  );
  expect(
    within(drawer).getByRole('button', {
      name: 'Принять выбранные в перемещении (2)',
    }),
  ).toBeEnabled();
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Предыдущая страница' }),
  );
  expect(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение SKU1 / }),
  ).toBeChecked();
  fireEvent.change(
    within(drawer).getByRole('textbox', {
      name: 'Поиск по составу перемещения',
    }),
    { target: { value: 'SKU500' } },
  );
  expect(within(drawer).getByText('Товар 500')).toBeVisible();
  expect(within(drawer).getAllByRole('row')).toHaveLength(2);
});

it('keeps an empty route inspector open after its last accepted row is revoked following recalculation', async () => {
  let state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  const line = state.rebalance.proposal.transfers.find(
    (t) => t.fromBranchId === 'b0',
  )!;
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'accept',
      ids: [line.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  const current = harness(state);
  const root = screen
    .getByRole('heading', { name: 'Ребалансировка' })
    .closest('main')!.parentElement!;
  const { drawer } = openRoute();
  fireEvent.click(
    within(drawer).getByRole('button', { name: /Отменить принятие SKU1/ }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Отменить принятие перемещения' }),
    ).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() => expect(current().rebalance.accepted).toHaveLength(0));
  expect(drawer).toBeVisible();
  expect(drawer).toHaveTextContent('В этом направлении больше нет позиций.');
  expect(
    screen.queryByRole('dialog', { name: 'Отменить принятие перемещения' }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(drawer).getByRole('button', { name: 'Закрыть карточку' }),
  );
  expect(root.inert).not.toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: 'Условия' }));
  expect(
    screen.getByRole('heading', { name: 'Условия перемещений' }),
  ).toBeVisible();
});

it('shows sender-wide total and selected money while preserving hidden selections under search', () => {
  const state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  state.rebalance.tab = 'results';
  const first = state.rebalance.proposal.transfers[0]!;
  state.rebalance.proposal.transfers.push({
    ...first,
    sourceLineId: 'second-route',
    toBranchId: 'b1',
    qty: 5,
  });
  state.rebalance.selectedLineIds = [first.sourceLineId, 'second-route'];
  harness(state);
  const sender = () =>
    screen.getByRole('group', { name: 'Итоги отправителя Донор А' });
  expect(sender()).toHaveTextContent('Всего: 2 000,00');
  expect(sender()).toHaveTextContent('Выбрано: 2 000,00');
  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'Поиск по коду, артикулу, товару и маршруту',
    }),
    { target: { value: 'Получатель' } },
  );
  expect(sender()).toHaveTextContent('Всего: 2 000,00');
  expect(sender()).toHaveTextContent('Выбрано: 2 000,00');
  const { drawer, trigger } = openRoute();
  expect(trigger).toHaveTextContent('Выбрано на сумму: 1 500,00');
  expect(
    within(drawer).getByLabelText('Выбрано на сумму в перемещении'),
  ).toHaveTextContent('1 500,00');
});

it('offers CSV only after acceptance and keeps accepted/purchasing state when download fails', () => {
  let state = rebalanceAppState();
  state.rebalance.proposal = createProposal(state);
  const id = state.rebalance.proposal.transfers[0]!.sourceLineId;
  state.rebalance.tab = 'results';
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'accept',
      ids: [id],
      expectedRevision: 0,
    }).patch,
  };
  const current = harness(state);
  const before = structuredClone(current());
  const { drawer } = openRoute();
  const failure = vi
    .spyOn(downloads, 'downloadTransferCsv')
    .mockImplementation(() => {
      throw new Error('download failed');
    });
  try {
    fireEvent.click(
      within(drawer).getByRole('button', {
        name: 'Скачать CSV принятых позиций (1)',
      }),
    );
    expect(within(drawer).getByRole('alert')).toHaveTextContent(
      'Не удалось скачать CSV',
    );
    expect(current().rebalance.accepted).toEqual(before.rebalance.accepted);
    expect(derive(current()).purchaseDemand).toEqual(
      derive(before).purchaseDemand,
    );
    expect(
      within(drawer).getByRole('button', {
        name: 'Скачать CSV принятых позиций (1)',
      }),
    ).toBeEnabled();
  } finally {
    failure.mockRestore();
  }
});

it('does not enable movement CSV for selected proposals', () => {
  harness();
  const { drawer } = openRoute();
  fireEvent.click(
    within(drawer).getByRole('checkbox', {
      name: 'Выбрать видимые предложения',
    }),
  );
  expect(
    within(drawer).getByRole('button', {
      name: 'Скачать CSV принятых позиций (0)',
    }),
  ).toBeDisabled();
});
