import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { SUPPLIER_POOL } from '../../src/domain/supplierPool';
import { baseState, renderWithStore } from './renderWithStore';

const primary = 'ООО "Терем"';
const additional = 'ООО "Алмаз"';

function catalogState() {
  const state = baseState({
    supplierAssignments: [{ skuCode: 'SKU1', primary, additional: [additional] }],
  });
  state.minMax!.skus.push({
    code: '000000002',
    article: 'ART-2',
    name: 'Товар без потребности',
    referencePrice: 90,
    reportedTotalStock: 8,
  });
  state.minMax!.branchStocks.push({
    skuCode: '000000002',
    branch: 'Ленина',
    stock: 8,
    min: 2,
    max: 8,
  });
  return state;
}

describe('SuppliersPage', () => {
  it('includes products without demand and filters by assignment status, current demand and product identity', () => {
    renderWithStore(<SuppliersPage />, catalogState());
    expect(screen.getByRole('button', { name: 'Товары' })).toHaveAttribute('aria-pressed', 'true');
    const links = () => screen.queryByRole('button', { name: 'Связи 000000002' });
    expect(links()).toBeVisible();

    const status = screen.getByLabelText('Наличие основного');
    fireEvent.change(status, { target: { value: 'with-primary' } });
    expect(links()).not.toBeInTheDocument();
    fireEvent.change(status, { target: { value: 'without-primary' } });
    expect(links()).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Связи SKU1' })).not.toBeInTheDocument();

    const search = screen.getByRole('textbox', { name: 'Поиск товара' });
    for (const value of ['000000002', 'art-2', 'без потребности']) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getByRole('textbox', { name: 'Поиск товара' })).toBe(search);
      expect(links()).toBeVisible();
    }

    fireEvent.click(screen.getByLabelText('Есть потребность'));
    expect(links()).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Есть потребность'));
    fireEvent.click(links()!);
    expect(screen.getByRole('dialog', { name: 'Связи товара' })).toHaveTextContent('000000002');
    expect(screen.queryByRole('button', { name: 'Применить автовыбор' })).not.toBeInTheDocument();
  });

  it('shows every fixed supplier and links its role counts to the corresponding products', () => {
    renderWithStore(<SuppliersPage />, catalogState());
    const search = screen.getByRole('textbox', { name: 'Поиск товара' });
    fireEvent.change(search, { target: { value: 'ART-2' } });
    const suppliersView = () => fireEvent.click(screen.getByRole('button', { name: 'По поставщикам' }));
    suppliersView();
    const roster = screen.getByRole('table', { name: 'По поставщикам' });
    for (const name of SUPPLIER_POOL) expect(within(roster).getByText(name)).toBeVisible();
    const supplierSearch = screen.getByRole('textbox', { name: 'Поиск поставщика' });
    fireEvent.change(supplierSearch, { target: { value: 'Алмаз' } });
    expect(screen.getByRole('textbox', { name: 'Поиск поставщика' })).toBe(supplierSearch);
    fireEvent.change(supplierSearch, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Товары' }));
    expect(search).toHaveValue('ART-2');

    suppliersView();
    fireEvent.click(screen.getByRole('button', { name: `Дополнительные товары: ${additional}` }));
    expect(screen.getByLabelText('Поставщик')).toHaveValue(additional);
    const role = screen.getByLabelText('Роль поставщика');
    expect(role).toHaveValue('additional');
    expect(screen.getByRole('button', { name: 'Связи SKU1' })).toBeVisible();
    fireEvent.change(role, { target: { value: 'primary' } });
    expect(screen.queryByRole('button', { name: 'Связи SKU1' })).not.toBeInTheDocument();
    fireEvent.change(role, { target: { value: 'any' } });
    expect(screen.getByRole('button', { name: 'Связи SKU1' })).toBeVisible();
  });

  it('does not present an incomplete procurement amount as complete', () => {
    const state = catalogState();
    state.minMax!.skus[0]!.referencePrice = null;
    renderWithStore(<SuppliersPage />, state);
    fireEvent.click(screen.getByRole('button', { name: 'По поставщикам' }));
    const row = screen.getByRole('button', { name: primary }).closest('tr')!;
    expect(row).toHaveTextContent('Сумма неизвестна');
    expect(row).toHaveTextContent('Без цены: 2');
  });
});

it('restores the bulk selection for the same snapshot and starts clean for a new snapshot', () => {
  const state = catalogState();
  state.uiPreferences['suppliers:selectedCodes'] = {
    snapshotId: state.snapshotId,
    skuCodes: ['SKU1'],
  };
  const first = renderWithStore(<SuppliersPage />, state);
  expect(screen.getByRole('checkbox', { name: 'Выбрать SKU1' })).toBeChecked();
  first.unmount();

  renderWithStore(<SuppliersPage />, { ...state, snapshotId: 'weekly-min-max' });
  expect(screen.getByRole('checkbox', { name: 'Выбрать SKU1' })).not.toBeChecked();
});
