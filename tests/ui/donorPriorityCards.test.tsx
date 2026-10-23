import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DonorAllocationDrawer } from '../../src/features/rebalancing/DonorAllocationDrawer';
import type { DonorAllocationRow } from '../../src/domain/rebalancing/allocationPlan';

const recipients = Array.from({ length: 7 }, (_, i) => ({
  id: `r${i}`,
  name: `Подразделение ${i + 1}`,
}));
const rows: DonorAllocationRow[] = Array.from({ length: 6 }, (_, i) => ({
  skuCode: `SKU${i + 1}`,
  name: `Полное название товара ${i + 1}`,
  unit: 'шт',
  step: 1,
  fromBranchId: 'donor',
  stock: 48,
  max: 10,
  acceptedOutgoing: 0,
  availableQty: 38,
  plannedQty: 10,
  after: 38,
  decisionMode: 'AUTO',
  priorityRequired: true,
  cells: recipients.slice(0, i === 1 ? 1 : 7).map((r) => ({
    toBranchId: r.id,
    name: r.name,
    stock: 0,
    min: 5,
    max: 10,
    target: 10,
    need: 10,
    needToMax: 10,
    otherPlanned: 0,
    otherPlannedRejected: 0,
    rejectedQty: 0,
    acceptedIncoming: 0,
    qty: r.id === 'r0' ? 10 : 0,
    acceptedQty: 0,
    priority: false,
    locked: false,
    canAllocate: true,
    sourceLineId: JSON.stringify([`SKU${i + 1}`, 'donor', r.id]),
  })),
}));
function drawer(onEdit = vi.fn(async () => undefined)) {
  render(
    <DonorAllocationDrawer
      name="Донор"
      fromBranchId="donor"
      rows={rows}
      recipients={recipients}
      mode="PROPORTIONAL"
      onEdit={onEdit}
      onClose={() => undefined}
      onResults={() => undefined}
      stale={false}
      saving={false}
      error=""
    />,
  );
  return onEdit;
}
it('shows a continuous SKU list with every division in each card and no page switches', () => {
  drawer();
  const list = screen.getByRole('list', { name: 'Список перемещений донора' });
  const cards = within(list).getAllByRole('listitem');
  expect(cards).toHaveLength(6);
  for (const card of cards)
    for (const recipient of recipients)
      expect(
        within(card).getByRole('group', {
          name: `Получатель ${recipient.name}`,
        }),
      ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Следующие товары' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Следующие получатели' }),
  ).not.toBeInTheDocument();
  const unavailable = within(cards[1]!).getByRole('group', {
    name: 'Получатель Подразделение 7',
  });
  expect(unavailable).toHaveTextContent('Нет потребности или маршрута');
  expect(within(unavailable).queryByRole('spinbutton')).not.toBeInTheDocument();
});
it('keeps exact business commands, full-name disclosure, empty search and clear behavior', () => {
  const onEdit = drawer();
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Подразделение 7'), {
    target: { value: '3' },
  });
  expect(onEdit).toHaveBeenCalledWith({
    kind: 'quantity',
    skuCode: 'SKU1',
    fromBranchId: 'donor',
    toBranchId: 'r6',
    qty: 3,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Показать товар SKU1' }));
  expect(screen.getByRole('dialog', { name: 'Товар SKU1' })).toHaveTextContent(
    'Полное название товара 1',
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  const search = screen.getByRole('textbox', { name: 'Поиск товара' });
  fireEvent.change(search, { target: { value: 'SKU6' } });
  expect(search).toHaveAccessibleName('Поиск товара');
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByRole('listitem')).toHaveTextContent('SKU6');
  fireEvent.change(search, { target: { value: 'Отсутствует' } });
  expect(
    screen.getByText('Нет товаров по выбранному фильтру.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Очистить/ }));
  expect(screen.getAllByRole('listitem')).toHaveLength(6);
  expect(search).toHaveFocus();
});
