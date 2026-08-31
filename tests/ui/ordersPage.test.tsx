import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import { baseState, renderWithStore } from './renderWithStore';

const mocks = vi.hoisted(() => ({
  downloadReadyOrdersZip: vi.fn(),
  buildSupplierWorkbook: vi.fn(),
}));

vi.mock('../../src/export/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/download')>();
  return {
    ...actual,
    downloadReadyOrdersZip: mocks.downloadReadyOrdersZip,
  };
});

vi.mock('../../src/export/supplierWorkbook', () => ({
  buildSupplierWorkbook: mocks.buildSupplierWorkbook,
}));

describe('OrdersPage', () => {
  beforeEach(() => {
    mocks.downloadReadyOrdersZip.mockReset();
    mocks.downloadReadyOrdersZip.mockResolvedValue(undefined);
    mocks.buildSupplierWorkbook.mockReset();
    mocks.buildSupplierWorkbook.mockResolvedValue(new ArrayBuffer(8));
  });

  it('shows a supplier-total column in the order matrix', () => {
    renderWithStore(<OrdersPage />, baseState());
    expect(screen.getByText('Итого поставщику')).toBeInTheDocument();
  });

  it('reports ZIP generation failures instead of leaving an unhandled rejection', async () => {
    const set = vi.fn();
    mocks.downloadReadyOrdersZip.mockRejectedValueOnce(new Error('zip failed'));
    renderWithStore(<OrdersPage />, baseState(), set);

    fireEvent.click(screen.getByRole('button', { name: /скачать все \(2\)/i }));

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        toast: 'Не удалось сформировать ZIP с заказами. Повторите выгрузку.',
      }),
    );
  });

  it('reports supplier XLSX generation failures', async () => {
    const set = vi.fn();
    mocks.buildSupplierWorkbook.mockRejectedValueOnce(new Error('xlsx failed'));
    renderWithStore(<OrdersPage />, baseState(), set);

    fireEvent.click(screen.getByRole('button', { name: /excel все/i }));

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        toast: 'Не удалось сформировать Excel для Поставщик А. Повторите выгрузку.',
      }),
    );
  });
});
