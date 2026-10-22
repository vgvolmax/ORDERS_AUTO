import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { App } from '../../src/app/App';
import { workspaceFromState } from '../../src/app/workspaceSession';
import * as workspaces from '../../src/persistence/workspaces';
import { baseState } from './renderWithStore';
import {
  buildMinMaxFixture,
  buildSupplierFixture,
} from '../fixtures/workbookBuilders';

vi.mock('../../src/persistence/workspaces', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/persistence/workspaces')
  >();
  return { ...actual, saveWorkspace: vi.fn(actual.saveWorkspace) };
});
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const actual = await vi.importActual<typeof workspaces>(
    '../../src/persistence/workspaces',
  );
  vi.mocked(workspaces.saveWorkspace)
    .mockReset()
    .mockImplementation(actual.saveWorkspace);
});
const reports = [
  { index: 0, key: 'minMaxFileName' as const, build: buildMinMaxFixture },
  { index: 1, key: 'supplierFileName' as const, build: buildSupplierFixture },
];
function deferredFile(bytes: ArrayBuffer, name: string) {
  let resolve!: (bytes: ArrayBuffer) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<ArrayBuffer>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', { value: () => pending });
  return {
    file,
    resolve: () => resolve(bytes),
    reject: () => reject(new Error('read failed')),
  };
}
async function seed() {
  await workspaces.saveWorkspace(
    workspaceFromState(
      baseState({
        workspaceRevision: 0,
        page: 'import',
        minMaxFileName: 'original.xlsx',
        supplierFileName: 'supplier.xlsx',
      }),
    ),
    -1,
  );
  render(<App />);
  return screen.findAllByLabelText(/выбрать файл/i);
}
async function reopen() {
  vi.mocked(workspaces.saveWorkspace).mockRejectedValueOnce(new Error('quota'));
  fireEvent.click(screen.getByRole('button', { name: 'История сеансов' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Открыть сохранённый сеанс' }),
  );
  const inputs = await screen.findAllByLabelText(/выбрать файл/i);
  await waitFor(() => expect(inputs[0]).not.toBeDisabled());
  return inputs;
}

it.each(reports)(
  'ignores an obsolete $key read after reopening and importing a newer report',
  async ({ index, key, build }) => {
    const inputs = await seed();
    const late = deferredFile(build(), 'old-slow.xlsx');
    fireEvent.change(inputs[index]!, { target: { files: [late.file] } });
    const freshInputs = await reopen();
    fireEvent.change(freshInputs[index]!, {
      target: { files: [new File([build()], 'newer.xlsx')] },
    });
    await screen.findByText('newer.xlsx');
    const saved = await workspaces.loadActiveWorkspace();
    await act(async () => late.resolve());
    expect((await workspaces.loadActiveWorkspace())!.data[key]).toBe(
      'newer.xlsx',
    );
    expect(await workspaces.loadActiveWorkspace()).toEqual(saved);
  },
);

it.each(
  reports.flatMap((report) =>
    ['resolve', 'reject'].map((outcome) => ({
      ...report,
      outcome: outcome as 'resolve' | 'reject',
    })),
  ),
)(
  'does not let an obsolete $key $outcome clear the replacement session loading state',
  async ({ index, build, outcome }) => {
    const inputs = await seed();
    const late = deferredFile(build(), 'old-slow.xlsx');
    fireEvent.change(inputs[index]!, { target: { files: [late.file] } });
    const freshInputs = await reopen();
    const fresh = deferredFile(build(), 'newer.xlsx');
    fireEvent.change(freshInputs[index]!, { target: { files: [fresh.file] } });
    try {
      expect(freshInputs[index]).toBeDisabled();
      await act(async () => late[outcome]());
      await waitFor(() =>
        expect(
          screen.queryByText('Сохранение сеанса…'),
        ).not.toBeInTheDocument(),
      );
      expect(freshInputs[index]).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Перейти к потребности' }),
      ).toBeDisabled();
    } finally {
      await act(async () => fresh.resolve());
    }
    await screen.findByText('newer.xlsx');
  },
);

it('keeps a restored workspace import busy when an earlier workspace read finishes', async () => {
  const archive = workspaceFromState(
    baseState({
      workspaceRevision: 0,
      page: 'import',
      minMaxFileName: 'archived.xlsx',
    }),
  );
  await workspaces.saveWorkspace(archive, -1);
  const current = workspaceFromState(
    baseState({
      workspaceRevision: 0,
      page: 'import',
      minMaxFileName: 'original.xlsx',
    }),
  );
  current.previousActive = {
    workspaceId: archive.workspaceId,
    revision: archive.revision,
  };
  await workspaces.saveWorkspace(current, -1);
  render(<App />);
  const oldInput = await screen.findByLabelText('Выбрать файл Отчёт MIN/MAX');
  const late = deferredFile(buildMinMaxFixture(), 'old-slow.xlsx');
  fireEvent.change(oldInput, { target: { files: [late.file] } });
  fireEvent.click(screen.getByRole('button', { name: 'История сеансов' }));
  const row = await screen.findByRole('row', { name: /archived.xlsx/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Восстановить' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Восстановить копию' }),
  );
  await screen.findByRole('heading', { name: 'Импорт отчётов 1С' });
  const freshInput = screen.getByLabelText('Выбрать файл Отчёт MIN/MAX');
  const fresh = deferredFile(buildMinMaxFixture(), 'newer.xlsx');
  fireEvent.change(freshInput, { target: { files: [fresh.file] } });
  try {
    await act(async () => late.resolve());
    await waitFor(() =>
      expect(screen.queryByText('Сохранение сеанса…')).not.toBeInTheDocument(),
    );
    expect(freshInput).toBeDisabled();
    expect((await workspaces.loadActiveWorkspace())!.data.minMaxFileName).toBe(
      'archived.xlsx',
    );
  } finally {
    await act(async () => fresh.resolve());
  }
  await screen.findByText('newer.xlsx');
});
