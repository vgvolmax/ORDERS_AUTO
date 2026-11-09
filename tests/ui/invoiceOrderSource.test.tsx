import { beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { StoreContext } from '../../src/app/appStore';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { saveWorkspace } from '../../src/persistence/workspaces';
import { selectInvoiceOrders } from '../../src/app/invoiceOrders';
import { useInvoiceOrders } from '../../src/features/invoices/useInvoiceOrders';
import { baseState } from './renderWithStore';
import type { ReactNode } from 'react';

const supplier = 'ИП Баранов Роман Борисович';
const lenina = `Ленина\0${supplier}`;
const stupino = `Ступино\0${supplier}`;

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

it('selects checked and previously exported positive orders, including threshold overrides', () => {
  const state = baseState({
    settings: { minimumOrderAmount: 1200, thresholdMode: 'BRANCH_SUPPLIER' },
    edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 3 }],
    reviewedOrderIds: [lenina],
    exportedOrderIds: [stupino],
  });
  expect(selectInvoiceOrders(state)).toMatchObject([
    { id: lenina, reviewed: true, exported: false, lines: [{ orderQty: 3, unitPrice: 100 }] },
    { id: stupino, reviewed: false, exported: true, status: 'BLOCKED' },
  ]);
  const zeroed = {
    ...state,
    edits: [...state.edits, { skuCode: 'SKU1', branch: 'Ступино', qty: 0 }],
  };
  expect(selectInvoiceOrders(zeroed).map(({ id }) => id)).toEqual([lenina]);
  expect(selectInvoiceOrders(baseState())).toEqual([]);
});

it('reads an archived order without restoring its workspace and detects a stale current source', async () => {
  const historical = baseState({
    workspaceRevision: 0,
    minMaxFileName: 'прошлая неделя.xlsx',
    reviewedOrderIds: [lenina],
    edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }],
  });
  await saveWorkspace(workspaceFromState(historical), -1);
  const current = baseState({ workspaceRevision: 0, exportedOrderIds: [lenina] });
  await saveWorkspace({
    ...workspaceFromState(current),
    previousActive: { workspaceId: historical.workspaceId, revision: 0 },
  }, -1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StoreContext.Provider value={{ state: current, set: vi.fn() }}>{children}</StoreContext.Provider>
  );
  const { result } = renderHook(useInvoiceOrders, { wrapper });
  await waitFor(() => expect(result.current.sources).toHaveLength(2));
  expect(result.current.orders[0]?.lines[0]?.orderQty).toBe(7);
  act(() => result.current.selectSource(historical.workspaceId));
  await waitFor(() => expect(result.current.orders[0]?.lines[0]?.orderQty).toBe(2));
  await expect(result.current.verifySource()).resolves.toBeUndefined();
  act(() => result.current.selectSource(current.workspaceId));
  await expect(result.current.verifySource()).resolves.toBeUndefined();
  await saveWorkspace(workspaceFromState({ ...current, workspaceRevision: 1 }), 0);
  await expect(result.current.verifySource()).rejects.toThrow('Сеанс изменился');
});
