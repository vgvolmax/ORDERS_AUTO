import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext, type StatePatch } from '../../src/app/appStore';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { createProposal } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
export function Harness() {
  const [state, update] = useState(() => { const s = rebalanceAppState(); s.rebalance.proposal = createProposal(s); s.rebalance.tab = 'results'; return s; });
  const set = (p: StatePatch) => update((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  return <StoreContext.Provider value={{ state, set, commit: async (p) => set(p) }}><output aria-label="Текущая закупка">{derive(state).purchaseDemand.reduce((a, l) => a + l.purchaseQty, 0)}</output><RebalancingPage /></StoreContext.Provider>;
}
it('selection is independent; accept subset, cancel dialog, accept rest, recalculate and revoke', async () => {
  render(<Harness />);
  const rows = screen.getAllByRole('checkbox', { name: /Выбрать перемещение/ });
  fireEvent.click(rows[0]!); expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('50');
  fireEvent.click(screen.getByRole('button', { name: /Принять выбранные \(1\)/ }));
  let dialog = screen.getByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('50');
  fireEvent.click(screen.getByRole('button', { name: /Принять выбранные \(1\)/ }));
  dialog = screen.getByRole('dialog'); expect(dialog).toHaveTextContent('50 → 35');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Принять перемещения' }));
  await waitFor(() => expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('35'));
  fireEvent.click(screen.getByRole('checkbox', { name: /Выбрать перемещение/ }));
  fireEvent.click(screen.getByRole('button', { name: /Принять выбранные \(1\)/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Принять перемещения' }));
  await waitFor(() => expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('15'));
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать перемещения' }));
  expect(screen.getAllByText('Принято')).toHaveLength(2);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Рассчитать перемещения' })).toBeEnabled());
  fireEvent.click(screen.getAllByRole('button', { name: /Отменить принятие/ })[0]!);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отменить принятие' }));
  await waitFor(() => expect(screen.getByLabelText('Текущая закупка')).toHaveTextContent('30'));
});
