import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { renderWithStore } from './renderWithStore';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
it('offers recipient settings, explicit quantity policies and mirrored direct routes without a donor slider', () => {
  const state = rebalanceAppState(); const patches: unknown[] = [];
  renderWithStore(<RebalancingPage />, state, vi.fn((p) => patches.push(typeof p === 'function' ? p(state) : p)));
  expect(screen.getByLabelText('Получатель')).toHaveValue('BELOW_MIN'); expect(screen.getAllByRole('slider')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Получатель'), { target: { value: 'BELOW_MAX' } });
  expect(patches).toContainEqual(expect.objectContaining({ rebalance: expect.objectContaining({ config: expect.objectContaining({ recipientTrigger: 'BELOW_MAX' }) }) }));
  fireEvent.click(screen.getByRole('tab', { name: 'Маршруты' }));
  // Test store does not rerender automatically; the durable tab change is itself asserted.
  expect(patches).toContainEqual(expect.objectContaining({ rebalance: expect.objectContaining({ tab: 'routes' }) }));
});

it('mirrors one-way routes and keeps the diagonal unavailable', async () => {
  const { RoutesMatrix } = await import('../../src/features/rebalancing/RoutesMatrix');
  const { render } = await import('@testing-library/react');
  const { useState } = await import('react');
  function Routes() { const [value, set] = useState<import('../../src/domain/rebalancing').RouteConfig>({ mode: 'SELECTIVE', pairs: [] }); return <RoutesMatrix registry={rebalanceAppState().rebalance.registry} value={value} onChange={set} />; }
  render(<Routes />);
  expect(screen.getAllByLabelText('Внутри подразделения')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Маршрут Донор А → Получатель'), { target: { value: 'A_TO_B' } });
  expect(screen.getByLabelText('Маршрут Получатель → Донор А')).toHaveValue('B_TO_A');
});
it('does not invent quantity policies and explicitly assigns the operators unit and step', () => {
  const state = rebalanceAppState(); state.rebalance.policies = [];
  const patches: unknown[] = []; renderWithStore(<RebalancingPage />, state, (p) => patches.push(typeof p === 'function' ? p(state) : p));
  expect(screen.getByLabelText('Единица SKU1')).toHaveValue(''); expect(screen.getByLabelText('Шаг SKU1')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Единица для ненастроенных SKU'), { target: { value: 'кг' } });
  fireEvent.change(screen.getByLabelText('Шаг для ненастроенных SKU'), { target: { value: '0.25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Назначить ненастроенным (1)' }));
  expect(patches).toContainEqual(expect.objectContaining({ rebalance: expect.objectContaining({ policies: [{ skuCode: 'SKU1', unit: 'кг', quantityStep: 0.25 }] }) }));
});
