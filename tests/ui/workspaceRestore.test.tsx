import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { saveWorkspace } from '../../src/persistence/workspaces';
import { baseState } from './renderWithStore';
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
it('restores imported reports and working page without a second import', async () => {
  const state = baseState({ workspaceRevision: 0, page: 'orders', minMaxFileName: 'min.xlsx', supplierFileName: 'sup.xls' });
  await saveWorkspace(workspaceFromState(state), -1);
  render(<App />);
  expect(await screen.findByRole('heading', { name: /Заказы/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ленина' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Импорт отчётов 1С' })).not.toBeInTheDocument();
});
