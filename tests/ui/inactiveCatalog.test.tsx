import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { baseState, renderWithStore } from './renderWithStore';

const primary = 'ИП Баранов Роман Борисович';
const additional = 'ИП Никишин Андрей Николаевич';
function catalogState() {
  const state = baseState();
  state.minMax!.skus[0]!.article = '000123';
  const old = baseState();
  old.minMax!.skus = [{ ...old.minMax!.skus[0]!, code: '000123', article: '000123', name: 'Отсутствующий товар' }];
  state.catalog = createSupplierCatalog(state, [old])!;
  state.catalog.products.find(p => p.code === '000123')!.unit = 'м';
  state.catalog.assignments.push({ skuCode: '000123', primary, additional: [additional] });
  return state;
}
const inactive = () => fireEvent.click(screen.getByRole('button', { name: 'Неактивные · 1' }));
const current = () => fireEvent.click(screen.getByRole('button', { name: 'Товары · 1' }));

it('separates products by exact 1C code even when their articles match', () => {
  renderWithStore(<SuppliersPage />, catalogState());
  expect(screen.getByRole('button', { name: 'Товары · 1' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Связи SKU1' })).toBeVisible();
  expect(screen.queryByText('Отсутствующий товар')).not.toBeInTheDocument();
  inactive();
  const region = screen.getByRole('region', { name: 'Неактивные товары' });
  expect(region).toHaveTextContent('000123');
  expect(region).toHaveTextContent('Отсутствующий товар');
  expect(region).not.toHaveTextContent('Товар 1');
});

it('shows inactive units and all supplier links without selection or editing controls', () => {
  const state = catalogState();
  state.uiPreferences['suppliers:inactiveProductFilters'] = { query: '', primary: 'all', supplier: '', role: 'any', hasDemand: true };
  renderWithStore(<SuppliersPage />, state);
  inactive();
  const region = screen.getByRole('region', { name: 'Неактивные товары' });
  expect(region).toHaveTextContent(/не участвуют в расчётах/i);
  const table = within(region).getByRole('table');
  expect(within(table).getByText('м', { exact: true })).toBeVisible();
  expect(table).toHaveTextContent(primary);
  expect(table).toHaveTextContent(additional);
  expect(within(region).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(within(region).queryByRole('button', { name: /Связи|Назначить|Переместить|Активировать/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps searches independent and counts stable while filtering and clearing inactive products', () => {
  renderWithStore(<SuppliersPage />, catalogState());
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск товара' }), { target: { value: 'SKU1' } });
  inactive();
  const search = screen.getByRole('textbox', { name: 'Поиск товара' });
  expect(search).toHaveValue('');
  for (const value of ['000123', 'Отсутствующий', 'нет совпадений']) {
    fireEvent.change(search, { target: { value } });
    expect(screen.getByRole('button', { name: 'Неактивные · 1' })).toBeVisible();
  }
  expect(screen.getByText('Нет товаров по выбранным фильтрам.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(search).toHaveFocus();
  expect(screen.getByText('Отсутствующий товар')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Поставщик'), { target: { value: additional } });
  fireEvent.change(screen.getByLabelText('Роль поставщика'), { target: { value: 'additional' } });
  expect(screen.getByText('Отсутствующий товар')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Роль поставщика'), { target: { value: 'primary' } });
  expect(screen.queryByText('Отсутствующий товар')).not.toBeInTheDocument();
  current();
  expect(screen.getByRole('textbox', { name: 'Поиск товара' })).toHaveValue('SKU1');
  expect(screen.getByLabelText('Поставщик')).toHaveValue('');
});

it('does not let saved presence filters or inactive selection leak into active bulk actions', async () => {
  const state = catalogState();
  state.uiPreferences['suppliers:productFilters'] = { presence: 'absent', query: '', primary: 'all', supplier: '', role: 'any', hasDemand: false };
  state.uiPreferences['suppliers:selectedCodes'] = { snapshotId: state.snapshotId, skuCodes: ['SKU1', '000123'] };
  const set = vi.fn();
  renderWithStore(<SuppliersPage />, state, set);
  expect(screen.getByRole('checkbox', { name: 'Выбрать SKU1' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Назначить основного выбранным' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Выбрано товаров: 1');
  fireEvent.change(within(dialog).getByLabelText('Основной поставщик'), { target: { value: additional } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Назначить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const patch = set.mock.calls.map(([value]) => typeof value === 'function' ? value(state) : value).find(value => value.catalog);
  expect(patch.catalog.assignments.find((a: {skuCode: string}) => a.skuCode === 'SKU1')?.primary).toBe(additional);
  expect(patch.catalog.assignments.find((a: {skuCode: string}) => a.skuCode === '000123')?.primary).toBe(primary);
});

it('keeps zero stock and missing prices or norms active as long as the code is in MIN/MAX', () => {
  const state = catalogState();
  state.minMax!.skus[0]!.referencePrice = null;
  state.minMax!.branchStocks.forEach(row => { row.stock = 0; row.min = null; row.max = null; });
  renderWithStore(<SuppliersPage />, state);
  expect(screen.getByRole('button', { name: 'Связи SKU1' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Товары · 1' })).toBeVisible();
  inactive();
  expect(screen.getByText('Отсутствующий товар')).toBeVisible();
});

it('does not classify the whole catalog as inactive before MIN/MAX is loaded', () => {
  const state = catalogState();
  state.minMax = null;
  renderWithStore(<SuppliersPage />, state);
  expect(screen.getByRole('button', { name: 'Товары · —' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Неактивные · —' }));
  expect(screen.getByText(/Загрузите MIN\/MAX, чтобы определить активность товаров/)).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('Отсутствующий товар')).not.toBeInTheDocument();
  expect(screen.queryByText(/Отсутствуют в MIN\/MAX выбранного сеанса/)).not.toBeInTheDocument();
});

it('distinguishes an empty inactive list from an unsuccessful search', () => {
  const state = baseState();
  state.catalog = createSupplierCatalog(state);
  renderWithStore(<SuppliersPage />, state);
  fireEvent.click(screen.getByRole('button', { name: 'Неактивные · 0' }));
  expect(screen.getByText('Все товары справочника есть в MIN/MAX выбранного сеанса.')).toBeVisible();
});
