import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { workspaceFromState } from '../../src/app/workspaceSession';
import {
  loadActiveWorkspace,
  loadWorkspace,
  saveWorkspace,
} from '../../src/persistence/workspaces';
import { buildMinMaxFixture } from '../fixtures/workbookBuilders';
import { baseState } from './renderWithStore';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

it('resets weekly order decisions only in the new workspace after MIN/MAX is saved', async () => {
  const oldOrderId = 'Ленина\0ИП Баранов Роман Борисович';
  const original = workspaceFromState(baseState({
    workspaceRevision: 0,
    page: 'orders',
    minMaxFileName: 'original.xlsx',
    supplierFileName: 'suppliers.xls',
    reviewedOrderIds: [oldOrderId],
    exportedOrderIds: [oldOrderId],
    edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }],
  }));
  await saveWorkspace(original, -1);
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Обновить MIN/MAX' }));
  const input = await screen.findByLabelText('Выбрать файл Отчёт MIN/MAX');
  expect(screen.queryByLabelText('Выбрать файл Отчёт поставщиков')).toBeNull();
  expect(await loadActiveWorkspace()).toEqual(original);
  fireEvent.change(input, {
    target: { files: [new File([buildMinMaxFixture()], 'weekly.xlsx')] },
  });

  await screen.findByText('weekly.xlsx');
  const latest = (await loadActiveWorkspace())!;
  expect(latest.workspaceId).not.toBe(original.workspaceId);
  expect(latest.data).toMatchObject({
    reviewedOrderIds: [],
    exportedOrderIds: [],
    edits: [],
    supplierFileName: 'suppliers.xls',
    supplierAssignments: original.data.supplierAssignments,
  });
  await waitFor(async () => {
    expect((await loadWorkspace(original.workspaceId))?.data).toMatchObject({
      reviewedOrderIds: [oldOrderId],
      exportedOrderIds: [oldOrderId],
      edits: original.data.edits,
    });
  });
});
