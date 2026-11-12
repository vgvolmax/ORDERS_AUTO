import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StoreContext, type AppState, type StatePatch } from '../../src/app/appStore';
import { SharedCatalogPanel } from '../../src/features/suppliers/SharedCatalogPanel';
import { createSupplierCatalog } from '../../src/domain/supplierCatalog';
import { rememberCatalogLink } from '../../src/appbox/supplierCatalogBridge';
import { baseState } from './renderWithStore';

const first = 'ИП Баранов Роман Борисович';
const sharedDocument = {
  kind: 'volmax-supplier-catalog' as const,
  schemaVersion: 1 as const,
  suppliers: [first],
  products: [{ code: '00001', article: '0123', name: 'Общий товар', unit: 'шт' }],
  assignments: [{ skuCode: '00001', primary: first, additional: [] }],
};

afterEach(() => {
  delete window.AppBoxFiles;
  rememberCatalogLink(null);
});

function Harness({ commitSpy = vi.fn() }: { commitSpy?: ReturnType<typeof vi.fn> }) {
  const [state, setState] = useState<AppState>(() => {
    const initial = baseState();
    return { ...initial, catalog: createSupplierCatalog(initial) };
  });
  const commit = async (patch: StatePatch) => {
    commitSpy();
    setState((previous) => {
      const updates = typeof patch === 'function' ? patch(previous) : patch;
      return { ...previous, ...updates };
    });
  };
  return <StoreContext.Provider value={{ state, set: () => undefined, commit }}>
    <SharedCatalogPanel />
  </StoreContext.Provider>;
}

it('opens shared AppBox JSON and saves current catalog with the AppBox revision reference', async () => {
  const openedRef = { id: 'shared-doc', revision: 2, canEdit: true };
  const savedRef = { id: 'shared-doc', revision: 3, canEdit: true };
  const open = vi.fn().mockResolvedValue({ content: sharedDocument, document: openedRef });
  const save = vi.fn().mockResolvedValue({ destination: 'appbox', document: savedRef });
  window.AppBoxFiles = { open, save };
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
  await screen.findByText(/Общий справочник подключён/);
  // A current MIN/MAX product not yet in the remote document is added only locally.
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить в AppBox' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[1]).toMatchObject({
    filename: 'volmax-supplier-catalog.json',
    document: openedRef,
  });
  expect(save.mock.calls[0]?.[0].products.map((product: { code: string }) => product.code)).toEqual(['00001', 'SKU1']);
  await screen.findByText('Общий справочник сохранён в AppBox.');
});

it('honours canEdit=false and never attempts to overwrite a read-only shared document', async () => {
  const open = vi.fn().mockResolvedValue({
    content: sharedDocument,
    document: { id: 'readonly', revision: 2, canEdit: false },
  });
  const save = vi.fn();
  window.AppBoxFiles = { open, save };
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
  await screen.findByText(/Общий справочник подключён/);
  expect(screen.getByRole('button', { name: 'Сохранить в AppBox' })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it('does not change local catalog or document association after cancelling or invalid JSON', async () => {
  const commitSpy = vi.fn();
  const open = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
    content: '{ broken', document: { id: 'invalid', revision: 1, canEdit: true },
  });
  const save = vi.fn();
  window.AppBoxFiles = { open, save };
  render(<Harness commitSpy={commitSpy} />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(commitSpy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Некорректный JSON');
  expect(commitSpy).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('does not mark an unchanged opened JSON dirty because parsing reordered object fields', async () => {
  const content = {
    ...sharedDocument,
    products: [...sharedDocument.products, { code: 'SKU1', article: 'A-1', name: 'Товар 1', unit: 'шт' }],
    assignments: [...sharedDocument.assignments, { skuCode: 'SKU1', primary: first, additional: [] }],
  };
  window.AppBoxFiles = {
    open: vi.fn().mockResolvedValue({ content, document: { id: 'ref', revision: 1, title: 'Catalog', canEdit: true } }),
    save: vi.fn(),
  };
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть из AppBox' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
  await screen.findByText(/Общий справочник подключён/);
  expect(screen.getByRole('button', { name: 'Сохранить в AppBox' })).toBeDisabled();
});
