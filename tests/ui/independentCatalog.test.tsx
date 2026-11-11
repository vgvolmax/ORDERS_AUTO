import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { baseState, renderWithStore } from './renderWithStore';

it('shows absent catalog products, filters presence and edits their supplier without creating demand', async () => {
  const state = baseState();
  const old = baseState();
  old.minMax!.skus = [{ ...old.minMax!.skus[0]!, code: '000123', article: 'OLD', name: 'Отсутствующий товар' }];
  state.catalog = createSupplierCatalog(state, [old]);
  const set = vi.fn();
  renderWithStore(<SuppliersPage />, state, set);
  const links = screen.getByRole('button', { name: 'Связи 000123' });
  expect(links).toBeVisible();
  expect(within(links.closest('[role="row"]')!).getByText('Нет в MIN/MAX')).toBeVisible();
  const presence = screen.getByLabelText('Наличие в MIN/MAX');
  fireEvent.change(presence, { target: { value: 'current' } });
  expect(screen.queryByRole('button', { name: 'Связи 000123' })).not.toBeInTheDocument();
  fireEvent.change(presence, { target: { value: 'absent' } });
  expect(screen.queryByRole('button', { name: 'Связи SKU1' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Связи 000123' }));
  const dialog = screen.getByRole('dialog', { name: 'Связи товара' });
  fireEvent.change(within(dialog).getByLabelText('Основной поставщик'), { target: { value: 'ИП Баранов Роман Борисович' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Сделать основным' }));
  const next = set.mock.calls.map(([patch]) => typeof patch === 'function' ? patch(state) : patch)
    .find((patch) => patch.catalog);
  expect(next).toBeDefined();
  expect(next.catalog.assignments.find((row: { skuCode: string }) => row.skuCode === '000123')?.primary).toBe('ИП Баранов Роман Борисович');
});
