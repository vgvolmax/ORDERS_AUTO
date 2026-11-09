import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import * as rebalancing from '../../src/domain/rebalancing';
import { DemandPage } from '../../src/features/demand/DemandPage';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { renderWithStore } from './renderWithStore';
function accepted(full = false) {
  let s = rebalanceAppState();
  if (full) {
    s.minMax!.branchStocks[0]!.stock = 110;
    s.minMax!.branchStocks[1]!.stock = 60;
  }
  s.rebalance.proposal = createProposal(s);
  return {
    ...s,
    ...prepareAcceptedChange(s, {
      kind: 'accept',
      ids: [s.rebalance.proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
}
it('shows effective need and status, with baseline and accepted movement in a compact popup', () => {
  const state = accepted();
  renderWithStore(<DemandPage branch="Получатель" />, state);
  const row = screen.getAllByRole('row')[1]!;
  expect(row).toHaveTextContent('35');
  expect(row).not.toHaveTextContent('Ниже MIN');
  const indicator = within(row).getByRole('button', {
    name: /Учтённые перемещения/,
  });
  expect(indicator).toHaveTextContent('Перемещения(1)');
  expect(indicator).toHaveAttribute(
    'title',
    'Потребность с учётом принятых перемещений: 1',
  );
  fireEvent.click(
    within(row).getByRole('button', { name: /Учтённые перемещения/ }),
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('50');
  expect(dialog).toHaveTextContent('35');
  expect(dialog).toHaveTextContent('15');
  expect(within(dialog).queryByText('Донор Б')).not.toBeInTheDocument();
});
it('fully covered SKU leaves supplier problems, and remains accessible among all goods', () => {
  const state = accepted(true);
  state.suppliers!.history = [];
  state.suppliers!.suppliers = [];
  const view = renderWithStore(<SuppliersPage />, state);
  expect(screen.getByRole('button', { name: 'Связи SKU1' })).toBeVisible();
  fireEvent.click(screen.getByLabelText('Есть потребность'));
  expect(screen.queryByRole('button', { name: 'Связи SKU1' })).not.toBeInTheDocument();
  view.unmount();
  renderWithStore(<DemandPage />, state);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Показать покрытые перемещениями' }),
  );
  expect(screen.getByText('SKU1')).toBeInTheDocument();
});
it('explains a manual quantity in both order views using the same accepted basis', () => {
  const state = accepted();
  state.edits = [{ skuCode: 'SKU1', branch: 'Получатель', qty: 40 }];
  renderWithStore(<OrdersPage />, state);
  fireEvent.click(screen.getByRole('button', { name: /SKU · Готов/ }));
  fireEvent.click(screen.getByRole('button', { name: /Учтённые перемещения/ }));
  expect(
    screen.getByRole('dialog', { name: 'Учтённые перемещения' }),
  ).toHaveTextContent('Ручное количество к заказу: 40');
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(
    screen.getByRole('button', { name: /Все заказы ИП Баранов/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: /Учтённые перемещения/ }));
  expect(
    screen.getByRole('dialog', { name: 'Учтённые перемещения' }),
  ).toHaveTextContent('Ручное количество к заказу: 40');
});
it('shows movement counts in both order views before calculating popup details', () => {
  const summary = vi.spyOn(rebalancing, 'buildMovementSummary');
  try {
    renderWithStore(<OrdersPage />, accepted());
    fireEvent.click(screen.getByRole('button', { name: /SKU · Готов/ }));
    const indicator = screen.getByRole('button', { name: /Учтённые перемещения/ });
    expect(indicator).toHaveTextContent('Перемещения(1)');
    expect(summary).not.toHaveBeenCalled();
    fireEvent.click(indicator);
    expect(screen.getByRole('dialog', { name: 'Учтённые перемещения' })).toHaveTextContent('Донор А');
    expect(summary).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(screen.getByRole('button', { name: /Все заказы ИП Баранов/ }));
    expect(screen.getByRole('button', { name: /Учтённые перемещения/ })).toHaveTextContent('Перемещения(1)');
    expect(summary).toHaveBeenCalledTimes(1);
  } finally {
    summary.mockRestore();
  }
});
