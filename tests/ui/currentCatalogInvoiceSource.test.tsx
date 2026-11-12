import { beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { StoreContext } from '../../src/app/appStore';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { saveWorkspace } from '../../src/persistence/workspaces';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { useInvoiceOrders } from '../../src/features/invoices/useInvoiceOrders';
import { baseState } from './renderWithStore';
import { db } from '../../src/persistence/db';
import type { ReactNode } from 'react';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

it('refreshes archived unfinished invoice orders when the live catalog changes and clears their stale review', async () => {
  const historic = baseState({ workspaceRevision: 0, minMaxFileName: 'old.xlsx' });
  historic.catalog = createSupplierCatalog(historic);
  historic.reviewedOrderIds = [`Ленина\0${historic.supplierAssignments![0]!.primary}`];
  await saveWorkspace(workspaceFromState(historic), -1);
  let current = { ...baseState(), catalog: historic.catalog };
  const wrapper = ({ children }: { children: ReactNode }) => <StoreContext.Provider value={{ state: current, set: vi.fn() }}>{children}</StoreContext.Provider>;
  const { result, rerender } = renderHook(useInvoiceOrders, { wrapper });
  act(() => result.current.selectSource(historic.workspaceId));
  await waitFor(() => expect(result.current.orders).toHaveLength(1));
  current = { ...current, catalog: { ...current.catalog!, revision: 1, products: current.catalog!.products.map(product => ({ ...product, unit: 'упак' })) } };
  rerender();
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.orders).toEqual([]);
  expect(result.current.skuCodes).toEqual(['SKU1']);
});

it('rejects invoice work after another tab changes the shared local catalog revision', async () => {
  const state = baseState({ workspaceRevision: 0 });
  state.catalog = createSupplierCatalog(state);
  await saveWorkspace(workspaceFromState(state), -1, [], { catalog: { expectedRevision: -1, value: state.catalog! } });
  const wrapper = ({ children }: { children: ReactNode }) => <StoreContext.Provider value={{ state, set: vi.fn() }}>{children}</StoreContext.Provider>;
  const { result } = renderHook(useInvoiceOrders, { wrapper });
  await expect(result.current.verifySource()).resolves.toBeUndefined();
  await (await db()).put('supplierCatalog', { ...state.catalog!, revision: 1 }, 'main');
  await expect(result.current.verifySource()).rejects.toThrow('Справочник изменился');
});
