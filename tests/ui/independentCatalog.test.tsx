import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { derive } from '../../src/app/selectors';
import { baseState, renderWithStore } from './renderWithStore';

it('keeps absent identities visible for inspection without creating procurement demand', () => {
  const state = baseState();
  const old = baseState();
  old.minMax!.skus = [{ ...old.minMax!.skus[0]!, code: '000123', article: 'OLD', name: 'Отсутствующий товар' }];
  state.catalog = createSupplierCatalog(state, [old]);
  renderWithStore(<SuppliersPage />, state);
  fireEvent.click(screen.getByRole('button', { name: 'Неактивные · 1' }));
  expect(screen.getByText('Отсутствующий товар')).toBeVisible();
  expect(screen.getByText('Неактивен')).toBeVisible();
  expect(derive(state).demand.some(line => line.skuCode === '000123')).toBe(false);
  expect(derive(state).projection.orders.flatMap(order => order.lines).some(line => line.skuCode === '000123')).toBe(false);
});
