import { IDBFactory } from 'fake-indexeddb';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadActiveWorkspace,
  loadWorkspaceFile,
} from '../../src/persistence/workspaces';
import { App } from '../../src/app/App';
import {
  buildMinMaxFixture,
  buildSupplierFixture,
} from '../fixtures/workbookBuilders';

function asFile(buffer: ArrayBuffer, name: string, type: string): File {
  return new File([buffer], name, { type });
}

function deferredFile(buffer: ArrayBuffer, name: string, type: string) {
  let resolve!: (value: ArrayBuffer) => void;
  const promise = new Promise<ArrayBuffer>((done) => {
    resolve = done;
  });
  const file = asFile(buffer, name, type);
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: () => promise,
  });
  return { file, resolve: () => resolve(buffer) };
}

describe('import workflow', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
  it('shows file summaries and non-fatal validation issues before continuing', async () => {
    render(<App />);

    const inputs = await screen.findAllByLabelText(/выбрать файл/i);
    fireEvent.change(inputs[0]!, {
      target: {
        files: [
          asFile(
            buildMinMaxFixture(),
            'Min-Max.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ),
        ],
      },
    });
    fireEvent.change(inputs[1]!, {
      target: {
        files: [
          asFile(
            buildSupplierFixture('xls'),
            'Поставщики.xls',
            'application/vnd.ms-excel',
          ),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/2 SKU/i)).toBeInTheDocument();
      expect(screen.getByText(/2 поставщик/i)).toBeInTheDocument();
    });

    const saved = await loadActiveWorkspace();
    expect(saved!.data.rawImports.minMax?.name).toBe('Min-Max.xlsx');
    expect(saved!.data.rawImports.suppliers?.name).toBe('Поставщики.xls');
    expect(
      (await loadWorkspaceFile(saved!.data.rawImports.minMax!.fileId))!.bytes
        .byteLength,
    ).toBe(buildMinMaxFixture().byteLength);

    // Fixture contains MIN > MAX and a missing reference price; both are warnings,
    // therefore import remains usable but the user must see them before ordering.
    expect(screen.getByText(/MIN больше MAX/i)).toBeInTheDocument();
    expect(screen.getByText(/нет цены/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /перейти к потребности/i }),
    ).toBeEnabled();
  });

  it('keeps each report busy until its own read finishes', async () => {
    render(<App />);

    const min = deferredFile(
      buildMinMaxFixture(),
      'Min-Max.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const suppliers = deferredFile(
      buildSupplierFixture('xls'),
      'Поставщики.xls',
      'application/vnd.ms-excel',
    );
    const inputs = await screen.findAllByLabelText(/выбрать файл/i);

    fireEvent.change(inputs[0]!, { target: { files: [min.file] } });
    fireEvent.change(inputs[1]!, { target: { files: [suppliers.file] } });

    const minCard = screen
      .getByRole('heading', { name: 'Отчёт MIN/MAX' })
      .closest('section');
    const supplierCard = screen
      .getByRole('heading', { name: 'Отчёт поставщиков' })
      .closest('section');

    expect(minCard).toHaveAttribute('aria-busy', 'true');
    expect(supplierCard).toHaveAttribute('aria-busy', 'true');

    min.resolve();
    await waitFor(() => expect(minCard).toHaveAttribute('aria-busy', 'false'));
    expect(supplierCard).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('button', { name: /перейти к потребности/i }),
    ).toBeDisabled();

    suppliers.resolve();
    await waitFor(() =>
      expect(supplierCard).toHaveAttribute('aria-busy', 'false'),
    );
  });
  it('does not let an old asynchronous read repopulate a newly started session', async () => {
    render(<App />);
    const inputs = await screen.findAllByLabelText(/выбрать файл/i);
    fireEvent.change(inputs[0]!, {
      target: { files: [asFile(buildMinMaxFixture(), 'original.xlsx', '')] },
    });
    fireEvent.change(inputs[1]!, {
      target: { files: [asFile(buildSupplierFixture(), 'supplier.xlsx', '')] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /перейти к потребности/i }),
      ).toBeEnabled(),
    );
    const late = deferredFile(buildMinMaxFixture(), 'late.xlsx', '');
    fireEvent.change(inputs[0]!, { target: { files: [late.file] } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Загрузить новые отчёты' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Начать новый сеанс' }));
    await waitFor(() =>
      expect(screen.queryByText('original.xlsx')).not.toBeInTheDocument(),
    );
    await act(async () => {
      late.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByText('late.xlsx')).not.toBeInTheDocument(),
    );
    expect((await loadActiveWorkspace())!.data.minMax).toBeNull();
  });
});
