import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useRef, useState } from 'react';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import type { StatePatch } from '../../src/app/appStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import { baseState, renderWithStore } from './renderWithStore';
import { StoreContext, type AppState } from '../../src/app/appStore';

function StatefulOrders({ initial }: { initial: AppState }) {
  const [state, setState] = useState(initial);
  return (
    <StoreContext.Provider
      value={{
        state,
        set: (patch) =>
          setState((current) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current) : patch),
          })),
      }}
    >
      <OrdersPage />
    </StoreContext.Provider>
  );
}

const mocks = vi.hoisted(() => ({
  downloadReadyOrdersZip: vi.fn(),
  buildSupplierWorkbook: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../../src/export/download', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/export/download')
  >();
  return {
    ...actual,
    save: mocks.save,
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

  it('moves supplier totals into the sticky supplier card', () => {
    renderWithStore(<OrdersPage />, baseState());
    expect(screen.queryByText('Итого поставщику')).not.toBeInTheDocument();
    const card = screen.getByRole('button', {
      name: /все заказы поставщик а/i,
    });
    expect(card).toHaveTextContent('1 100,00 ₽');
    expect(card).toHaveTextContent('2 подразделения · 1 SKU · 11 ед.');
  });

  it('opens the complete supplier-wide order set from the accessible supplier card', () => {
    render(
      <StatefulOrders
        initial={baseState({
          settings: {
            minimumOrderAmount: 500,
            thresholdMode: 'BRANCH_SUPPLIER',
          },
        })}
      />,
    );

    expect(screen.getByText('Скрыто порогом: 1')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /все заказы поставщик а/i }),
    );
    const dialog = screen.getByRole('dialog', {
      name: /все заказы поставщик а/i,
    });
    expect(within(dialog).getByText('Ленина')).toBeInTheDocument();
    expect(within(dialog).getByText('Ступино')).toBeInTheDocument();
  });

  it('keeps review and export state on a no-op quantity edit', () => {
    const set = vi.fn();
    renderWithStore(
      <OrdersPage />,
      baseState({
        reviewedOrderIds: ['Ленина\0Поставщик А'],
        exportedOrderIds: ['Ленина\0Поставщик А'],
      }),
      set,
    );

    fireEvent.click(screen.getByRole('button', { name: /проверен.*700,00/i }));
    const input = screen.getByLabelText('Количество SKU1');
    fireEvent.change(input, { target: { value: '7.0' } });

    expect(set).toHaveBeenCalledWith({ toast: 'Количество не изменилось.' });
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({ reviewedOrderIds: expect.anything() }),
    );
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({ exportedOrderIds: expect.anything() }),
    );
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
        toast:
          'Не удалось сформировать Excel для Поставщик А. Повторите выгрузку.',
      }),
    );
  });

  it('keeps global all/reviewed exports independent from supplier search', async () => {
    const state = baseState({
      minMax: {
        skus: [
          {
            code: 'SKU1',
            article: 'A-1',
            name: 'Товар 1',
            referencePrice: 100,
            reportedTotalStock: 5,
          },
          {
            code: 'SKU2',
            article: 'A-2',
            name: 'Товар 2',
            referencePrice: 50,
            reportedTotalStock: 5,
          },
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
          {
            supplier: 'Поставщик А',
            skuCode: 'SKU1',
            skuName: 'Товар 1',
            unit: 'шт',
            purchaseQty: 10,
            purchaseAmount: 1000,
            weightedUnitCost: 100,
          },
          {
            supplier: 'Поставщик Б',
            skuCode: 'SKU2',
            skuName: 'Товар 2',
            unit: 'шт',
            purchaseQty: 10,
            purchaseAmount: 500,
            weightedUnitCost: 50,
          },
        ],
      },
      reviewedOrderIds: ['Ленина\0Поставщик А', 'Ступино\0Поставщик Б'],
    });
    renderWithStore(<OrdersPage />, state);

    fireEvent.change(screen.getByLabelText(/поиск поставщика/i), {
      target: { value: 'Поставщик А' },
    });
    expect(
      screen.getByRole('button', { name: /скачать все \(4\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /скачать проверенные \(2\)/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /скачать все \(4\)/i }));
    await waitFor(() =>
      expect(mocks.downloadReadyOrdersZip).toHaveBeenCalled(),
    );
    expect(mocks.downloadReadyOrdersZip.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it('recalculates matrix, branch, supplier and order-card state through one edit pipeline', () => {
    render(
      <StatefulOrders
        initial={baseState({
          reviewedOrderIds: ['Ленина\0Поставщик А', 'Ступино\0Поставщик А'],
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /все заказы поставщик а/i }),
    );
    const dialog = screen.getByRole('dialog', {
      name: /все заказы поставщик а/i,
    });
    fireEvent.change(within(dialog).getByLabelText('Количество SKU1 Ленина'), {
      target: { value: '10' },
    });

    expect(within(dialog).getAllByText('1 400,00 ₽')).toHaveLength(2);
    expect(
      within(dialog).getByRole('columnheader', { name: /Ленина/i }),
    ).toHaveTextContent('1 000,00 ₽');
    const skuRow = within(dialog).getByText('A-1').closest('tr')!;
    expect(skuRow).toHaveTextContent('14');
    expect(skuRow).toHaveTextContent('1 400,00 ₽');
    expect(within(dialog).getByText(/✋\s*1/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Проверен Ленина' }),
    ).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(
      screen.getByRole('button', { name: /все заказы поставщик а/i }),
    ).toHaveTextContent('1 400,00 ₽');
    const editedCard = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.classList.contains('order-cell') &&
          button.classList.contains('manual-edited'),
      );
    expect(editedCard).toHaveTextContent('1 000,00 ₽');
    expect(editedCard).toHaveTextContent('✋ 1');
  });

  it('marks only the exported payload when quantity changes while a workbook is being generated', async () => {
    let finish!: (buffer: ArrayBuffer) => void;
    mocks.buildSupplierWorkbook.mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    );
    render(<StatefulOrders initial={baseState()} />);
    fireEvent.click(screen.getByRole('button', { name: /excel все/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /все заказы поставщик а/i }),
    );
    fireEvent.change(screen.getByLabelText('Количество SKU1 Ленина'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    finish(new ArrayBuffer(8));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    await waitFor(() => {
      const cards = screen
        .getAllByRole('button')
        .filter((b) => b.classList.contains('order-cell'));
      expect(
        cards.find((c) =>
          c.textContent?.replace(/\s/g, '').includes('1000,00'),
        ),
      ).not.toHaveClass('EXPORTED');
      expect(cards.find((c) => c.textContent?.includes('400,00'))).toHaveClass(
        'EXPORTED',
      );
    });
  });

  it('keeps the last typed value when it returns to the old quantity before a prior write completes', async () => {
    let finish!: () => void,
      writes = 0;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    function DurableOrders() {
      const [state, publish] = useState(() => baseState());
      const session = useRef<ReturnType<typeof createWorkspaceSession> | null>(
        null,
      );
      if (!session.current)
        session.current = createWorkspaceSession({
          initial: state,
          publish,
          save: async () => {
            if (++writes === 1) await gate;
          },
        });
      const commit = (patch: StatePatch) => session.current!.commit(patch);
      return (
        <StoreContext.Provider
          value={{
            state,
            set: (patch) => {
              void commit(patch);
            },
            commit,
          }}
        >
          <OrdersPage />
        </StoreContext.Provider>
      );
    }
    render(<DurableOrders />);
    fireEvent.click(screen.getByRole('button', { name: /700,00/ }));
    fireEvent.change(screen.getByLabelText('Количество SKU1'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Количество SKU1'), {
      target: { value: '7' },
    });
    await waitFor(() => expect(writes).toBe(1));
    finish();
    await waitFor(() => expect(writes).toBe(2));
    await waitFor(() =>
      expect(screen.getByLabelText('Количество SKU1')).toHaveValue(7),
    );
  });

  it('uses neutral, reviewed and blocker-priority presentation states', () => {
    const { rerender } = renderWithStore(<OrdersPage />, baseState());
    const neutral = screen
      .getAllByRole('button')
      .find((button) => button.classList.contains('order-cell'))!;
    expect(neutral).not.toHaveClass('reviewed');
    expect(neutral).not.toHaveClass('has-blocker');

    rerender(
      <StoreContext.Provider
        value={{
          state: baseState({ reviewedOrderIds: ['Ленина\0Поставщик А'] }),
          set: () => undefined,
        }}
      >
        <OrdersPage />
      </StoreContext.Provider>,
    );
    expect(
      screen.getByRole('button', { name: /проверен.*700,00/i }),
    ).toHaveClass('is-reviewed');

    const blocked = baseState({
      reviewedOrderIds: ['Ленина\0Поставщик А'],
      minMax: {
        ...baseState().minMax!,
        skus: [{ ...baseState().minMax!.skus[0]!, referencePrice: null }],
      },
      suppliers: {
        suppliers: ['Поставщик А'],
        history: [
          {
            ...baseState().suppliers!.history[0]!,
            weightedUnitCost: null,
            purchaseQty: 0,
            purchaseAmount: 0,
          },
        ],
      },
    });
    rerender(
      <StoreContext.Provider value={{ state: blocked, set: () => undefined }}>
        <OrdersPage />
      </StoreContext.Provider>,
    );
    const blockerCard = screen
      .getAllByRole('button')
      .find((button) => button.classList.contains('order-cell'))!;
    expect(blockerCard).toHaveClass('has-blocker', 'BLOCKED');
    expect(blockerCard).not.toHaveClass('is-reviewed');
    expect(
      screen.getByRole('button', { name: /скачать проверенные \(0\)/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /все заказы поставщик а/i }),
    ).toHaveClass('has-blocker');
  });

  it('uses a horizontal status line for reviewed manually edited orders', () => {
    renderWithStore(
      <OrdersPage />,
      baseState({
        edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 8 }],
        reviewedOrderIds: ['Ленина\0Поставщик А'],
        exportedOrderIds: ['Ленина\0Поставщик А'],
      }),
    );

    const card = screen.getByRole('button', {
      name: /проверен.*изменено вручную 1/i,
    });
    expect(card).toHaveClass('reviewed', 'is-reviewed', 'EXPORTED');
    const statuses = card.querySelector('.order-status-line');
    expect(statuses).toHaveTextContent('✓');
    expect(statuses).toHaveTextContent('✋ 1');
  });
});
