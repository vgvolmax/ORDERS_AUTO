import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { saveWorkspace } from '../../src/persistence/workspaces';
import { loadSupplierCatalog } from '../../src/persistence/supplierCatalog';
import { baseState } from './renderWithStore';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('scrollTo', vi.fn());
});

it.each(['restore', 'complete'] as const)('recovers every historic identity during first catalog creation through %s', async (path) => {
  const old = workspaceFromState(baseState({ workspaceRevision: 0, minMaxFileName: 'old.xlsx' }));
  old.data.minMax!.skus = [{ ...old.data.minMax!.skus[0]!, code: 'HIST-ONLY', article: '000987', name: 'Товар из другого архива' }];
  old.data.supplierAssignments = [{ skuCode: 'HIST-ONLY', primary: 'ИП Никишин Андрей Николаевич', additional: [] }];
  await saveWorkspace(old, -1);
  const chosen = workspaceFromState(baseState({ workspaceRevision: 0, minMaxFileName: 'recover.xlsx', page: 'all' }));
  chosen.previousActive = { workspaceId: old.workspaceId, revision: 0 };
  await saveWorkspace(chosen, -1);
  const incomplete = workspaceFromState(baseState({ workspaceRevision: 0, minMaxFileName: 'unfinished.xlsx', page: 'import' }));
  delete incomplete.data.supplierAssignments;
  incomplete.previousActive = { workspaceId: chosen.workspaceId, revision: 0 };
  await saveWorkspace(incomplete, -1);
  render(<App />);
  const proceed = await screen.findByRole('button', { name: 'Перейти к потребности' });
  expect(await loadSupplierCatalog()).toBeNull();
  if (path === 'complete') fireEvent.click(proceed);
  else {
    fireEvent.click(screen.getByRole('button', { name: 'История сеансов' }));
    const row = await screen.findByRole('row', { name: /recover\.xlsx/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Восстановить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Восстановить копию' }));
  }
  await waitFor(async () => {
    const catalog = await loadSupplierCatalog();
    expect(catalog?.products.find((product) => product.code === 'HIST-ONLY')).toEqual({
      code: 'HIST-ONLY', article: '000987', name: 'Товар из другого архива',
    });
    expect(catalog?.assignments).toEqual(chosen.data.supplierAssignments);
  });
});
