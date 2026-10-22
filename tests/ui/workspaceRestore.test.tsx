import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { App } from '../../src/app/App';
import { workspaceFromState } from '../../src/app/workspaceSession';
import {
  loadActiveWorkspace,
  saveWorkspace,
} from '../../src/persistence/workspaces';
import { baseState } from './renderWithStore';
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
it('restores imported reports and working page without a second import', async () => {
  const state = baseState({
    workspaceRevision: 0,
    page: 'orders',
    minMaxFileName: 'min.xlsx',
    supplierFileName: 'sup.xls',
  });
  await saveWorkspace(workspaceFromState(state), -1);
  render(<App />);
  expect(await screen.findByRole('heading', { name: /Заказы/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ленина' })).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Импорт отчётов 1С' }),
  ).not.toBeInTheDocument();
});

it('restores an excluded choice as unresolved and persists an explicit allowed replacement without deleting history', async () => {
  const state = baseState({ workspaceRevision: 0, page: 'orders' });
  const allowed = state.suppliers!.history[0]!.supplier;
  const hidden = 'ООО Скрытый поставщик';
  state.suppliers!.suppliers.push(hidden);
  state.suppliers!.history.push({
    ...state.suppliers!.history[0]!,
    supplier: hidden,
  });
  state.overrides = [
    {
      skuCode: 'SKU1',
      supplier: hidden,
      source: 'MANUAL',
      updatedAt: '2026-10-01',
    },
  ];
  state.reviewedOrderIds = state.exportedOrderIds = [`Ленина\0${hidden}`];
  await saveWorkspace(workspaceFromState(state), -1);
  render(<App />);
  await screen.findByRole('heading', { name: 'Заказы' });
  expect(
    screen.queryByRole('button', { name: `Все заказы ${hidden}` }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Скачать все (0)' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Поставщики' }));
  const choice = await screen.findByRole('combobox', {
    name: 'Поставщик SKU1',
  });
  expect(within(choice).getAllByRole('option')).toHaveLength(2);
  expect(screen.getByText(/не входит в рабочий пул/)).toBeVisible();
  fireEvent.change(choice, { target: { value: allowed } });
  await waitFor(() =>
    expect(
      screen.queryByRole('combobox', { name: 'Поставщик SKU1' }),
    ).not.toBeInTheDocument(),
  );
  const saved = (await loadActiveWorkspace())!.data;
  expect(saved.overrides[0]!.supplier).toBe(allowed);
  expect(saved.suppliers!.history.some((row) => row.supplier === hidden)).toBe(
    true,
  );
});
