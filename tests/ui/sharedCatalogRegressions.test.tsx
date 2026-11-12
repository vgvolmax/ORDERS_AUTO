import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { App } from '../../src/app/App';
import { StoreContext, type AppState, type StatePatch } from '../../src/app/appStore';
import { SharedCatalogPanel } from '../../src/features/suppliers/SharedCatalogPanel';
import { rememberCatalogLink } from '../../src/appbox/supplierCatalogBridge';
import { baseState } from '../ui/renderWithStore';
import { applySharedCatalog } from '../../src/domain/sharedSupplierCatalog';
import { resolveSupplierAssignments } from '../../src/domain/supplierAssignments';
import { derive } from '../../src/app/selectors';
import { workspaceFromState, stateFromWorkspace, createWorkspaceSession } from '../../src/app/workspaceSession';
import { selectInvoiceOrders } from '../../src/app/invoiceOrders';
import { buildWorkbook } from '../fixtures/workbookBuilders';

const first = 'ИП Баранов Роман Борисович';
const second = 'ООО "Терем"';
const document = {
  kind: 'volmax-supplier-catalog' as const, schemaVersion: 1 as const,
  suppliers: [first, second],
  products: [{ code: 'SKU1', article: 'A-1', name: 'Товар 1', unit: 'шт' }],
  assignments: [{ skuCode: 'SKU1', primary: first, additional: [] as string[] }],
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  rememberCatalogLink(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => { delete window.AppBoxFiles; rememberCatalogLink(null); vi.restoreAllMocks(); });

it('R1 allows a fresh operator to open the shared JSON without a private supplier report', async () => {
  window.AppBoxFiles = { open: vi.fn().mockResolvedValue({ content: document, document: { id: 'ref', revision: 1, title: 'Catalog', canEdit: true } }), save: vi.fn() };
  render(<App />);
  await screen.findByRole('heading', { name: 'Импорт отчётов 1С' });
  expect(screen.queryByRole('button', { name: 'Открыть из AppBox' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  await screen.findByText(/Общий справочник подключён/);
  expect(screen.getByRole('button', { name: 'Перейти к потребности' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Заказы' })).not.toBeInTheDocument();
  const minMax = new File([buildWorkbook([
    ['Код', 'Артикул', 'Номенклатура', 'Количество', 'Минимальный остаток', 'Максимальный остаток', 'Цена'],
    ['SKU1', 'A-1', 'Товар 1', null, null, null, 100],
    [null, null, 'Ленина', 0, 1, 2, null],
  ])], 'week.xlsx');
  fireEvent.change(screen.getByLabelText('Выбрать файл Отчёт MIN/MAX'), { target: { files: [minMax] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Перейти к потребности' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Перейти к потребности' }));
  const orders = await screen.findByRole('button', { name: 'Заказы' });
  await waitFor(() => expect(orders).toBeEnabled());
  fireEvent.click(orders);
  expect(await screen.findByRole('button', { name: `Все заказы ${first}` })).toHaveTextContent('200,00');
});

function ReloadedOperator() {
  const [state, setState] = useState<AppState>(() => {
    const initial = baseState();
    const catalog = applySharedCatalog(null, { ...document, assignments: [{ skuCode: 'SKU1', primary: second, additional: [] }] });
    return { ...initial, catalog, supplierAssignments: catalog.assignments };
  });
  const commit = async (patch: StatePatch) => setState(current => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
  return <StoreContext.Provider value={{ state, set: () => undefined, commit }}>
    <SharedCatalogPanel />
    <output data-testid="persisted-primary">{state.catalog?.assignments[0]?.primary}</output>
  </StoreContext.Provider>;
}

it('R2 does not silently overwrite local unpublished assignments after reload', async () => {
  window.AppBoxFiles = {
    open: vi.fn().mockResolvedValue({ content: document, document: { id: 'ref', revision: 1, title: 'Catalog', canEdit: true } }),
    save: vi.fn(),
  };
  render(<ReloadedOperator />);
  expect(screen.getByTestId('persisted-primary')).toHaveTextContent(second);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  await waitFor(() => expect(screen.queryByText(/Общий справочник подключён/)
    ?? screen.queryByRole('dialog', { name: 'Подтвердить обновление справочника' })).not.toBeNull());
  expect(screen.getByTestId('persisted-primary')).toHaveTextContent(second);
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.getByTestId('persisted-primary')).toHaveTextContent(second);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Открыть из AppBox' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
  await screen.findByText(/Общий справочник подключён/);
  expect(screen.getByTestId('persisted-primary')).toHaveTextContent(first);
});

it('R3 preserves shared-only units in archived invoice orders', () => {
  const initial = baseState({ suppliers: { suppliers: [], history: [] }, supplierAssignments: document.assignments });
  const state = { ...initial, catalog: applySharedCatalog(null, document) };
  const orders = derive(state).projection.orders;
  expect(orders[0]!.lines[0]!.unit).toBe('шт');
  state.reviewedOrderIds = orders.map(order => order.id);
  const archived = selectInvoiceOrders(stateFromWorkspace(workspaceFromState(state)));
  expect(archived[0]!.lines[0]!.unit).toBe('шт');
});

it('R4 does not turn conflicting history units into an apparently known unit', () => {
  const initial = baseState();
  const history = initial.suppliers!.history[0]!;
  const [resolution] = resolveSupplierAssignments(document.assignments, ['SKU1'], [
    { ...history, unit: 'шт' }, { ...history, supplier: first.toLowerCase(), unit: 'упак' },
  ], [first], new Map([['SKU1', 'шт']]));
  expect(resolution!.candidates[0]!.unit).toBeNull();
});

it('R5 invalidates a reviewed/exported order when its shared unit changes', async () => {
  const initial = baseState({ suppliers: { suppliers: [], history: [] }, supplierAssignments: document.assignments });
  const state = { ...initial, catalog: applySharedCatalog(null, document) };
  const ids = derive(state).projection.orders.map(order => order.id);
  state.reviewedOrderIds = ids;
  state.exportedOrderIds = ids;
  const session = createWorkspaceSession({ initial: state, save: async () => undefined, publish: () => undefined });
  const nextDocument = { ...document, products: [{ ...document.products[0]!, unit: 'упак' }] };
  await session.commit({
    catalog: applySharedCatalog(state.catalog, nextDocument),
    supplierAssignments: nextDocument.assignments.map(row => ({ ...row })),
  });
  expect(derive(session.getState()).projection.orders[0]!.lines[0]!.unit).toBe('упак');
  expect(session.getState().reviewedOrderIds).toEqual([]);
  expect(session.getState().exportedOrderIds).toEqual([]);
});

it('keeps the previous unit and review markers after a failed durable catalog write', async () => {
  const initial = baseState({ suppliers: { suppliers: [], history: [] }, supplierAssignments: document.assignments });
  const state = { ...initial, catalog: applySharedCatalog(null, document) };
  state.reviewedOrderIds = derive(state).projection.orders.map(order => order.id);
  const session = createWorkspaceSession({ initial: state, save: async () => { throw new Error('disk'); }, publish: () => undefined });
  await expect(session.commit({
    catalog: applySharedCatalog(state.catalog, { ...document, products: [{ ...document.products[0]!, unit: 'упак' }] }),
  })).rejects.toThrow('disk');
  expect(session.getState()).toBe(state);
  expect(derive(session.getState()).projection.orders[0]!.lines[0]!.unit).toBe('шт');
  expect(session.getState().reviewedOrderIds).toEqual(state.reviewedOrderIds);
});
