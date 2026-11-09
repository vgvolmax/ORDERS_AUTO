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
  loadWorkspace,
  loadWorkspaceFile,
  saveWorkspace,
} from '../../src/persistence/workspaces';
import { App } from '../../src/app/App';
import { ImportPage } from '../../src/features/import/ImportPage';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { baseState, renderWithStore } from './renderWithStore';
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

  it('continues a saved import with both reports and no supplier assignments', async () => {
    const initial = baseState({
      page: 'import',
      workspaceRevision: 0,
      minMaxFileName: 'Min-Max.xlsx',
      supplierFileName: 'Поставщики.xls',
    });
    delete initial.supplierAssignments;
    await saveWorkspace(workspaceFromState(initial), -1);
    render(<App />);

    const next = await screen.findByRole('button', { name: 'Перейти к потребности' });
    expect(next).toBeEnabled();
    expect(screen.queryByText(/Осталось загрузить/)).not.toBeInTheDocument();
    fireEvent.click(next);

    await waitFor(async () => {
      const saved = await loadActiveWorkspace();
      expect(saved?.workspaceId).toBe(initial.workspaceId);
      expect(saved?.data).toMatchObject({
        page: 'all',
        minMaxFileName: 'Min-Max.xlsx',
        supplierFileName: 'Поставщики.xls',
        supplierAssignments: [{
          skuCode: 'SKU1',
          primary: 'ИП Баранов Роман Борисович',
          additional: [],
        }],
      });
    });
    expect(screen.getByRole('button', { name: /^Заказы$/ })).toBeEnabled();
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

  it('counts only residual demand when showing SKUs without a primary supplier', () => {
    const initial = rebalanceAppState();
    initial.supplierAssignments = [];
    initial.minMax!.branchStocks[0]!.stock = 110;
    initial.minMax!.branchStocks[1]!.stock = 60;
    const proposal = createProposal(initial);
    initial.rebalance.proposal = proposal;
    const { patch } = prepareAcceptedChange(initial, {
      kind: 'accept',
      ids: [proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    });
    renderWithStore(<ImportPage />, { ...initial, ...patch });
    expect(screen.getByText(/Без основного поставщика/)).toHaveTextContent(
      /Без основного поставщика\s*0/,
    );
  });
  it('keeps the active reports through an invalid weekly MIN/MAX and saves only a successful replacement', async () => {
    render(<App />);
    const inputs = await screen.findAllByLabelText(/выбрать файл/i);
    fireEvent.change(inputs[0]!, {
      target: {
        files: [asFile(buildMinMaxFixture(), 'original.xlsx', '')],
      },
    });
    fireEvent.change(inputs[1]!, {
      target: {
        files: [asFile(buildSupplierFixture(), 'supplier.xlsx', '')],
      },
    });
    const proceed = screen.getByRole('button', { name: /перейти к потребности/i });
    await waitFor(() => expect(proceed).toBeEnabled());
    const original = (await loadActiveWorkspace())!;
    const weeklyInput = screen.getByLabelText('Выбрать файл Отчёт MIN/MAX');
    const invalid = deferredFile(new ArrayBuffer(0), 'invalid.xlsx', '');
    fireEvent.change(weeklyInput, { target: { files: [invalid.file] } });

    expect(screen.getByText('original.xlsx')).toBeInTheDocument();
    expect(proceed).toBeDisabled();
    expect(await loadActiveWorkspace()).toEqual(original);
    await act(async () => invalid.resolve());
    await waitFor(() => expect(proceed).toBeEnabled());
    expect(await loadActiveWorkspace()).toEqual(original);

    fireEvent.change(weeklyInput, {
      target: { files: [asFile(buildMinMaxFixture(), 'weekly.xlsx', '')] },
    });
    await screen.findByText('weekly.xlsx');
    const latest = (await loadActiveWorkspace())!;
    expect(latest.workspaceId).not.toBe(original.workspaceId);
    expect(latest.data.rawImports.suppliers).toEqual(original.data.rawImports.suppliers);
    expect(await loadWorkspace(original.workspaceId)).toEqual(original);
  });
});
