import { useState } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext, type StatePatch } from '../../src/app/appStore';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { createProposal } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { AcceptTransfersDialog } from '../../src/features/rebalancing/AcceptTransfersDialog';
export function Harness({
  initial = rebalanceAppState,
}: { initial?: typeof rebalanceAppState } = {}) {
  const [state, update] = useState(() => {
    const s = initial();
    s.rebalance.proposal = createProposal(s);
    s.rebalance.tab = 'results';
    return s;
  });
  const set = (p: StatePatch) =>
    update((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  return (
    <StoreContext.Provider value={{ state, set, commit: async (p) => set(p) }}>
      <output aria-label="Текущая закупка">
        {derive(state).purchaseDemand.reduce((a, l) => a + l.purchaseQty, 0)}
      </output>
      <RebalancingPage />
    </StoreContext.Provider>
  );
}
it('shows the selected route, SKU count and amount in the acceptance confirmation', () => {
  render(<Harness />);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Открыть перемещение Донор А → Получатель',
    }),
  );
  const drawer = screen.getByRole('dialog', { name: 'Состав перемещения' });
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение/ }),
  );
  fireEvent.click(
    within(drawer).getByRole('button', {
      name: /Принять выбранные в перемещении/,
    }),
  );
  const dialog = screen.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  expect(dialog).toHaveTextContent('Донор: Донор А');
  expect(dialog).toHaveTextContent('Получатели: Получатель');
  expect(dialog).toHaveTextContent('SKU: 1');
  expect(dialog).toHaveTextContent('Сумма:');
  expect(
    within(dialog).getByRole('group', { name: 'Изменение закупки' }),
  ).toHaveTextContent('Было');
  expect(
    within(dialog).getByRole('group', { name: 'Изменение закупки' }),
  ).toHaveTextContent('Станет');
});
it('summarizes multiple selected donors and keeps missing prices unknown', () => {
  const initial = () => {
    const state = rebalanceAppState();
    state.minMax!.skus[0]!.referencePrice = null;
    state.suppliers!.history[0]!.weightedUnitCost = null;
    return state;
  };
  render(<Harness initial={initial} />);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Выбрать видимые предложения' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять выбранные (2)' }),
  );
  const dialog = screen.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  expect(dialog).toHaveTextContent('Донор: Донор А, Донор Б');
  expect(dialog).toHaveTextContent('Получатели: Получатель');
  expect(dialog).toHaveTextContent('SKU: 1');
  expect(dialog).toHaveTextContent('Сумма: Сумма неизвестна');
  expect(dialog).toHaveTextContent('Без цены: 2');
  const totals = within(dialog).getByRole('group', {
    name: 'Изменение закупки',
  });
  expect(totals).toHaveTextContent('БылоСумма неизвестна');
  expect(totals).toHaveTextContent('Станет0,00');
});
it('makes selection hidden by result filters explicit before a global acceptance', () => {
  render(<Harness />);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Выбрать видимые предложения' }),
  );
  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'Поиск по коду, артикулу, товару и маршруту',
    }),
    { target: { value: 'Донор А' } },
  );
  expect(screen.getByText('Скрыто фильтрами: 1')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Принять выбранные (2)' }),
  ).toBeEnabled();
});
it('selection is independent; accept subset, cancel dialog, accept rest, recalculate and revoke', async () => {
  render(<Harness />);
  const open = (from: string) => {
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Открыть перемещение ' + from + ' → Получатель',
      }),
    );
    return screen.getByRole('dialog', { name: 'Состав перемещения' });
  };
  let drawer = open('Донор А');
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение/ }),
  );
  expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('50');
  const accept = () =>
    fireEvent.click(
      within(drawer).getByRole('button', {
        name: /Принять выбранные в перемещении/,
      }),
    );
  accept();
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).getByRole('button', { name: 'Отмена' }),
  );
  expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('50');
  accept();
  let dialog = screen.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  expect(dialog).toHaveTextContent('50 → 35');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('35'),
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  drawer = open('Донор Б');
  fireEvent.click(
    within(drawer).getByRole('checkbox', { name: /Выбрать перемещение/ }),
  );
  accept();
  dialog = screen.getByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('0'),
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Рассчитать перемещения' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Рассчитать перемещения' }),
    ).toBeEnabled(),
  );
  drawer = open('Донор А');
  expect(within(drawer).getByText('Принято')).toBeVisible();
  fireEvent.click(
    within(drawer).getByRole('button', { name: /Отменить принятие/ }),
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Отменить принятие перемещения' }),
    ).getByRole('button', { name: 'Отменить принятие' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('15'),
  );
});

it('compares large purchase reports in linear work and reuses the comparison while saving', () => {
  const base = derive(rebalanceAppState()).purchaseDemand[0]!;
  const size = 1000;
  let keyReads = 0;
  const before = Array.from({ length: size }, (_, i) => ({
    ...base,
    get skuCode() {
      keyReads++;
      return `SKU${i}`;
    },
    purchaseQty: 50,
  }));
  const after = Array.from({ length: size }, (_, i) => ({
    ...base,
    skuCode: `SKU${i}`,
    purchaseQty: i === size - 1 ? 35 : 50,
  }));
  const props = {
    kind: 'accept' as const,
    count: 1,
    before,
    after,
    clearedEdits: 0,
    busy: false,
    error: '',
    onConfirm: () => undefined,
    onClose: () => undefined,
  };
  const { rerender } = render(<AcceptTransfersDialog {...props} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('50 → 35');
  expect(screen.getAllByRole('row')).toHaveLength(2);
  // Count actual data reads instead of a machine-dependent time limit.
  expect(keyReads).toBeLessThan(size * 10);
  keyReads = 0;
  rerender(<AcceptTransfersDialog {...props} busy />);
  expect(keyReads).toBe(0);
  expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled();
});

it('keeps bulk acceptance previews bounded instead of rendering every changed purchase row', () => {
  const base = derive(rebalanceAppState()).purchaseDemand[0]!;
  const before = Array.from({ length: 500 }, (_, i) => ({
    ...base,
    skuCode: `SKU${i}`,
    purchaseQty: 50,
  }));
  const after = before.map((line) => ({ ...line, purchaseQty: 35 }));
  render(
    <AcceptTransfersDialog
      kind="accept"
      count={500}
      before={before}
      after={after}
      clearedEdits={0}
      busy={false}
      error=""
      onConfirm={() => undefined}
      onClose={() => undefined}
    />,
  );
  expect(screen.getAllByRole('row').length).toBeLessThan(120);
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Изменённых строк закупки: 500',
  );
});
