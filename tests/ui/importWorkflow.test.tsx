import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { buildMinMaxFixture, buildSupplierFixture } from '../fixtures/workbookBuilders';

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
        files: [asFile(buildSupplierFixture('xls'), 'Поставщики.xls', 'application/vnd.ms-excel')],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/2 SKU/i)).toBeInTheDocument();
      expect(screen.getByText(/2 поставщик/i)).toBeInTheDocument();
    });

    // Fixture contains MIN > MAX and a missing reference price; both are warnings,
    // therefore import remains usable but the user must see them before ordering.
    expect(screen.getByText(/MIN больше MAX/i)).toBeInTheDocument();
    expect(screen.getByText(/нет цены/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /перейти к потребности/i })).toBeEnabled();
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

    const minCard = screen.getByRole('heading', { name: 'Отчёт MIN/MAX' }).closest('section');
    const supplierCard = screen.getByRole('heading', { name: 'Отчёт поставщиков' }).closest('section');

    expect(minCard).toHaveAttribute('aria-busy', 'true');
    expect(supplierCard).toHaveAttribute('aria-busy', 'true');

    min.resolve();
    await waitFor(() => expect(minCard).toHaveAttribute('aria-busy', 'false'));
    expect(supplierCard).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: /перейти к потребности/i })).toBeDisabled();

    suppliers.resolve();
    await waitFor(() => expect(supplierCard).toHaveAttribute('aria-busy', 'false'));
  });
});
