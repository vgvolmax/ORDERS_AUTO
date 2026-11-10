import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { listWorkspaces, loadActiveWorkspace, saveWorkspace } from '../../src/persistence/workspaces';
import { baseState } from './renderWithStore';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

it('opens history on first launch without creating an empty work session', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'История сеансов' }));
  await screen.findByText('Сохранённых сеансов пока нет.');
  expect(await listWorkspaces()).toEqual([]);
  expect(await loadActiveWorkspace()).toBeNull();
});

it('persists navigation without invalidating the active business revision', async () => {
  const saved = workspaceFromState(baseState({ workspaceRevision: 0, page: 'orders' }));
  await saveWorkspace(saved, -1);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /^Поставщики$/ }));
  await screen.findByRole('heading', { name: /^Поставщики$/ });
  await waitFor(async () => expect((await loadActiveWorkspace())?.data.page).toBe('suppliers'));
  expect((await loadActiveWorkspace())?.revision).toBe(saved.revision);
});
