import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import { baseState, renderWithStore } from './renderWithStore';
import { StoreContext, type AppState } from '../../src/app/appStore';

function StatefulOrders({ initial }: { initial: AppState }) {
  const [state, setState] = useState(initial);
  return (
    <StoreContext.Provider value={{ state, set: (patch) => setState((current) => ({ ...current, ...patch })) }}>
      <OrdersPage />
    </StoreContext.Provider>
  );
}

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

  it('keeps global all/reviewed exports independent from supplier search', async () => {
    const state = baseState({
      minMax: {
        skus: [
          { code: 'SKU1', article: 'A-1', name: 'Товар 1', referencePrice: 100, reportedTotalStock: 5 },
          { code: 'SKU2', article: 'A-2', name: 'Товар 2', referencePrice: 50, reportedTotalStock: 5 },
        ],
        branchStocks: [
          { skuCode: 'SKU1', branch: 'Ленина', stock: 3, min: 5, max: 10 },
          { skuCode: 'SKU1', branch: 'Ступино', stock: 6, min: 5, max: 10 },
          { skuCode: 'SKU2', branch: 'Ленина', stock: 3, min: 5, max: 10 },
          { skuCode: 'SKU2', branch: 'Ступино', stock: 6, min: 5, max: 10 },
        ],
        branches: ['Ленина', 'Ступино'],
      },
      suppliers: {
        suppliers: ['Поставщик А', 'Поставщик Б'],
        history: [
          { supplier: 'Поставщик А', skuCode: 'SKU1', skuName: 'Товар 1', unit: 'шт', purchaseQty: 10, purchaseAmount: 1000, weightedUnitCost: 100 },
          { supplier: 'Поставщик Б', skuCode: 'SKU2', skuName: 'Товар 2', unit: 'шт', purchaseQty: 10, purchaseAmount: 500, weightedUnitCost: 50 },
        ],
      },
      reviewedOrderIds: ['Ленина\0Поставщик А', 'Ступино\0Поставщик Б'],
    });
    renderWithStore(<OrdersPage />, state);

    fireEvent.change(screen.getByLabelText(/поиск поставщика/i), {
      target: { value: 'Поставщик А' },
    });
    expect(screen.getByRole('button', { name: /скачать все \(4\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /скачать проверенные \(2\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /скачать все \(4\)/i }));
    await waitFor(() => expect(mocks.downloadReadyOrdersZip).toHaveBeenCalled());
    expect(mocks.downloadReadyOrdersZip.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it('recalculates matrix, branch, supplier and order-card state through one edit pipeline', () => {
    render(<StatefulOrders initial={baseState({ reviewedOrderIds: ['Ленина\0Поставщик А', 'Ступино\0Поставщик А'] })} />);
    fireEvent.click(screen.getByRole('button', { name: /все заказы поставщик а/i }));
    const dialog = screen.getByRole('dialog', { name: /все заказы поставщик а/i });
    fireEvent.change(within(dialog).getByLabelText('Количество SKU1 Ленина'), {
      target: { value: '10' },
    });

    expect(within(dialog).getAllByText('1 400,00 ₽')).toHaveLength(2);
    expect(within(dialog).getByRole('columnheader', { name: /Ленина/i })).toHaveTextContent('1 000,00 ₽');
    const skuRow = within(dialog).getByText('A-1').closest('tr')!;
    expect(skuRow).toHaveTextContent('14');
    expect(skuRow).toHaveTextContent('1 400,00 ₽');
    expect(within(dialog).getByText(/✋\s*1/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Проверен Ленина' })).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByRole('button', { name: /все заказы поставщик а/i })).toHaveTextContent('1 400,00 ₽');
    const editedCard = screen.getAllByRole('button').find(
      (button) => button.classList.contains('order-cell') && button.classList.contains('manual-edited'),
    );
    expect(editedCard).toHaveTextContent('1 000,00 ₽');
    expect(editedCard).toHaveTextContent('✋ 1');
  });

  it('uses neutral, reviewed and blocker-priority presentation states', () => {
    const { rerender } = renderWithStore(<OrdersPage />, baseState());
    const neutral = screen.getAllByRole('button').find((button) => button.classList.contains('order-cell'))!;
    expect(neutral).not.toHaveClass('reviewed');
    expect(neutral).not.toHaveClass('has-blocker');

    rerender(
      <StoreContext.Provider value={{ state: baseState({ reviewedOrderIds: ['Ленина\0Поставщик А'] }), set: () => undefined }}>
        <OrdersPage />
      </StoreContext.Provider>,
    );
    expect(screen.getByRole('button', { name: /проверен.*700,00/i })).toHaveClass('is-reviewed');

    const blocked = baseState({
      reviewedOrderIds: ['Ленина\0Поставщик А'],
      minMax: {
        ...baseState().minMax!,
        skus: [{ ...baseState().minMax!.skus[0]!, referencePrice: null }],
      },
      suppliers: {
        suppliers: ['Поставщик А'],
        history: [{ ...baseState().suppliers!.history[0]!, weightedUnitCost: null, purchaseQty: 0, purchaseAmount: 0 }],
      },
    });
    rerender(
      <StoreContext.Provider value={{ state: blocked, set: () => undefined }}>
        <OrdersPage />
      </StoreContext.Provider>,
    );
    const blockerCard = screen.getAllByRole('button').find((button) => button.classList.contains('order-cell'))!;
    expect(blockerCard).toHaveClass('has-blocker', 'BLOCKED');
    expect(blockerCard).not.toHaveClass('is-reviewed');
    expect(screen.getByRole('button', { name: /скачать проверенные \(0\)/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /все заказы поставщик а/i })).toHaveClass('has-blocker');
  });
});
