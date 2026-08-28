import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { buildMinMaxFixture, buildSupplierFixture } from '../fixtures/workbookBuilders';

function asFile(buffer: ArrayBuffer, name: string, type: string): File {
  return new File([buffer], name, { type });
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
});
