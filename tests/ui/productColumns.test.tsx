import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DemandPage } from '../../src/features/demand/DemandPage';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { baseState, renderWithStore } from './renderWithStore';

it.each([undefined, 'Ленина'])(
  'starts demand product columns with code, article and name (branch=%s)',
  (branch) => {
    renderWithStore(<DemandPage branch={branch} />, baseState());
    expect(
      screen
        .getAllByRole('columnheader')
        .slice(0, 3)
        .map((h) => h.textContent),
    ).toEqual(['Код', 'Артикул', 'Наименование']);
  },
);

it('identifies the product with full code, article and name when selecting its supplier', () => {
  const state = baseState();
  state.suppliers!.history = [];
  state.suppliers!.suppliers = [];
  state.minMax!.skus[0]!.article = 'ART-123';
  state.minMax!.skus[0]!.name = 'Полное имя товара';
  renderWithStore(<SuppliersPage />, state);
  const panel = screen
    .getByRole('heading', { name: /Требуют решения ·/ })
    .closest('section')!;
  expect(within(panel).getByText('ART-123')).toBeVisible();
  expect(within(panel).getByText('Полное имя товара')).toBeVisible();
  expect(
    within(panel)
      .getAllByRole('columnheader')
      .filter((h) => h.textContent)
      .slice(0, 3)
      .map((h) => h.textContent),
  ).toEqual(['Код', 'Артикул', 'Наименование']);
});

it('preserves supplier selections hidden by product search when selecting or clearing the filtered set', () => {
  const state = baseState();
  state.suppliers!.history = [];
  state.suppliers!.suppliers = [];
  state.minMax!.skus.push({
    ...state.minMax!.skus[0]!,
    code: 'SKU2',
    article: 'ART-TWO',
    name: 'Second',
  });
  state.minMax!.branchStocks.push(
    ...state.minMax!.branchStocks.map((l) => ({ ...l, skuCode: 'SKU2' })),
  );
  renderWithStore(<SuppliersPage />, state);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Выбрать SKU1' }),
  );
  fireEvent.change(
    screen.getByLabelText('Поиск товара для выбора поставщика'),
    { target: { value: 'ART-TWO' } },
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Выбрать все позиции' }),
  );
  expect(screen.getByText('Отмечено: 2')).toBeVisible();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Выбрать все позиции' }),
  );
  fireEvent.change(
    screen.getByLabelText('Поиск товара для выбора поставщика'),
    { target: { value: '' } },
  );
  expect(
    screen.getByRole('checkbox', { name: 'Выбрать SKU1' }),
  ).toBeChecked();
  expect(
    screen.getByRole('checkbox', { name: 'Выбрать SKU2' }),
  ).not.toBeChecked();
});
