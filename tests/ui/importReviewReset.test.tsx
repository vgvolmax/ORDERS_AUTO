import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImportPage } from '../../src/features/import/ImportPage';
import { buildSupplierFixture } from '../fixtures/workbookBuilders';
import { baseState, renderWithStore } from './renderWithStore';

describe('report import review invalidation', () => {
  it('clears checked and exported order markers when a supplier report is replaced', async () => {
    const set = vi.fn();
    renderWithStore(
      <ImportPage />,
      baseState({
        reviewedOrderIds: ['Ленина\0Поставщик А'],
        exportedOrderIds: ['Ленина\0Поставщик А'],
      }),
      set,
    );

    const supplierInput = screen.getByLabelText('Выбрать файл Отчёт поставщиков');
    fireEvent.change(supplierInput, {
      target: {
        files: [
          new File([buildSupplierFixture('xls')], 'Поставщики.xls', {
            type: 'application/vnd.ms-excel',
          }),
        ],
      },
    });

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewedOrderIds: [],
          exportedOrderIds: [],
        }),
      ),
    );
  });
});
