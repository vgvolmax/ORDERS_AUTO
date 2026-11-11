import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useRef, useState } from 'react';
import { createWorkspaceSession, workspaceFromState } from '../../src/app/workspaceSession';
import { saveWorkspace } from '../../src/persistence/workspaces';
import { IDBFactory } from 'fake-indexeddb';
import type { StatePatch } from '../../src/app/appStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import { derive } from '../../src/app/selectors';
import { orderToCsv } from '../../src/export/csv';
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

function twoSkuState(): AppState {
  const { minMax, suppliers } = baseState();
  return baseState({
    minMax: {
      ...minMax!,
      skus: [{ ...minMax!.skus[0]!, code: 'SKU10' }, ...minMax!.skus],
      branchStocks: [
        ...minMax!.branchStocks,
        { skuCode: 'SKU10', branch: 'Ленина', stock: 8, min: 5, max: 10 },
      ],
    },
    suppliers: {
      ...suppliers!,
      history: [
        ...suppliers!.history,
        { ...suppliers!.history[0]!, skuCode: 'SKU10' },
      ],
    },
  });
}

const mocks = vi.hoisted(() => ({
  downloadCsv: vi.fn(),
  downloadReadyOrdersZip: vi.fn(),
  buildSupplierWorkbook: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../../src/export/download', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/export/download')>();
  return {
    ...actual,
    downloadCsv: mocks.downloadCsv,
    save: mocks.save,
    downloadReadyOrdersZip: mocks.downloadReadyOrdersZip,
  };
});

vi.mock('../../src/export/supplierWorkbook', () => ({
  buildSupplierWorkbook: mocks.buildSupplierWorkbook,
}));

describe('OrdersPage', () => {
  beforeEach(() => {
    mocks.downloadCsv.mockClear();
    mocks.save.mockClear();
    mocks.downloadReadyOrdersZip.mockReset();
    mocks.downloadReadyOrdersZip.mockResolvedValue(undefined);
    mocks.buildSupplierWorkbook.mockReset();
    mocks.buildSupplierWorkbook.mockResolvedValue(new ArrayBuffer(8));
  });

  it('moves supplier totals into the sticky supplier card', () => {
    renderWithStore(<OrdersPage />, baseState());
    expect(screen.queryByText('Итого поставщику')).not.toBeInTheDocument();
    const card = screen.getByRole('button', {
      name: /все заказы ип баранов роман борисович/i,
    });
    expect(card).toHaveTextContent('1 100,00 ₽');
    expect(card).toHaveTextContent('2 подразделения · 1 SKU · 11 шт');
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
      screen.getByRole('button', {
        name: /все заказы ип баранов роман борисович/i,
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: /все заказы ип баранов роман борисович/i,
    });
    expect(within(dialog).getByText('Ленина')).toBeInTheDocument();
    expect(within(dialog).getByText('Ступино')).toBeInTheDocument();
  });

  it('uses source SKU order in both order drawers and the branch CSV', () => {
    const state = twoSkuState();
    const order = derive(state).projection.orders.find(
      (item) => item.branch === 'Ленина',
    )!;
    expect(
      orderToCsv(order).trim().split('\r\n').slice(1).map((row) => row.split(';')[0]),
    ).toEqual(['SKU10', 'SKU1']);
    render(<StatefulOrders initial={state} />);

    fireEvent.click(screen.getByRole('button', { name: /900,00.*Готов/ }));
    const single = screen.getByRole('dialog', { name: 'Состав заказа' });
    expect(
      within(single).getAllByRole('spinbutton').map((input) => input.getAttribute('aria-label')),
    ).toEqual(['Количество SKU10', 'Количество SKU1']);
    fireEvent.click(within(single).getByRole('button', { name: 'Закрыть' }));

    const matrixName = /все заказы ип баранов роман борисович/i;
    fireEvent.click(screen.getByRole('button', { name: matrixName }));
    const matrix = within(screen.getByRole('dialog', { name: matrixName }));
    expect(
      matrix.getAllByRole('row').slice(1).map(
        (row) => within(row).getAllByRole('cell')[0]?.textContent,
      ),
    ).toEqual(['SKU10', 'SKU1']);
  });

  it('excludes a line from a branch and restores its calculated quantity', () => {
    const orderId = 'Ленина\0ИП Баранов Роман Борисович';
    render(
      <StatefulOrders initial={baseState({
        edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 8 }],
        reviewedOrderIds: [orderId],
        exportedOrderIds: [orderId],
      })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /800,00.*Выгружен/ }));
    const drawer = within(screen.getByRole('dialog', { name: 'Состав заказа' }));
    const qty = drawer.getByRole('spinbutton', { name: 'Количество SKU1' });
    expect(drawer.getAllByRole('spinbutton')).toEqual([qty]);
    expect(qty).toHaveValue(8);
    expect(drawer.getByRole('checkbox', { name: 'Заказ проверен' })).toBeChecked();

    fireEvent.click(drawer.getByRole('button', { name: 'Исключить SKU1 из заказа' }));
    expect(qty).toHaveValue(0);
    expect(qty).toBeDisabled();
    expect(drawer.getByRole('checkbox', { name: 'Заказ проверен' })).not.toBeChecked();
    expect(drawer.queryByText('Выгружен')).not.toBeInTheDocument();
    expect(drawer.getByRole('button', { name: 'Скачать CSV заказа' })).toBeDisabled();

    fireEvent.click(drawer.getByRole('button', { name: 'Восстановить SKU1 в заказе' }));
    expect(qty).toHaveValue(7);
    expect(qty).toBeEnabled();
    expect(drawer.getByRole('button', { name: 'Скачать CSV заказа' })).toBeEnabled();
  });

  it('excludes a matrix SKU in all displayed branch orders in one durable write', async () => {
    const writes: AppState['edits'][] = [];
    const initial = twoSkuState();
    initial.settings = { minimumOrderAmount: 500, thresholdMode: 'SUPPLIER_TOTAL' };
    initial.edits = [{ skuCode: 'SKU1', branch: 'Ступино', qty: 0 }];
    initial.reviewedOrderIds = ['Ленина\0ИП Баранов Роман Борисович'];
    initial.exportedOrderIds = [...initial.reviewedOrderIds];
    function DurableOrders() {
      const [state, publish] = useState(initial);
      const session = useRef<ReturnType<typeof createWorkspaceSession> | null>(null);
      if (!session.current) {
        session.current = createWorkspaceSession({
          initial,
          publish,
          save: async (workspace) => { writes.push(workspace.data.edits); },
        });
      }
      return (
        <StoreContext.Provider value={{
          state,
          commit: (patch) => session.current!.commit(patch),
          set: (patch) => { void session.current!.commit(patch); },
        }}>
          <OrdersPage />
        </StoreContext.Provider>
      );
    }
    render(<DurableOrders />);
    const matrixName = /все заказы ип баранов роман борисович/i;
    fireEvent.click(screen.getByRole('button', { name: matrixName }));
    const matrix = within(screen.getByRole('dialog', { name: matrixName }));
    const leninaQty = matrix.getByRole('spinbutton', { name: 'Количество SKU1 Ленина' });
    const stupinoQty = matrix.getByRole('spinbutton', { name: 'Количество SKU1 Ступино' });
    const leninaHeader = within(matrix.getByRole('columnheader', { name: /Ленина/ }));
    expect(stupinoQty).toHaveValue(0);
    expect(stupinoQty).toBeEnabled();
    expect(leninaHeader.getByText('Выгружен')).toBeVisible();

    fireEvent.click(matrix.getByRole('button', {
      name: 'Исключить SKU1 во всех подразделениях',
    }));
    await waitFor(() => expect(leninaQty).toHaveValue(0));
    expect(leninaQty).toBeDisabled();
    expect(stupinoQty).toBeDisabled();
    expect(matrix.getByRole('spinbutton', { name: 'Количество SKU10 Ленина' })).toHaveValue(2);
    expect(leninaHeader.getByText('Ниже порога')).toBeVisible();
    expect(leninaHeader.getByRole('checkbox')).not.toBeChecked();
    expect(leninaHeader.queryByText('Выгружен')).not.toBeInTheDocument();
    expect(writes).toEqual([[
      { skuCode: 'SKU1', branch: 'Ленина', qty: 0, excluded: true },
      { skuCode: 'SKU1', branch: 'Ступино', qty: 0, excluded: true },
    ]]);
    const excludedOrder = derive({ ...initial, edits: writes[0]! })
      .projection.orders.find((order) => order.branch === 'Ленина')!;
    const csvLines = orderToCsv(excludedOrder).trim().split('\r\n').slice(1);
    expect(csvLines.map((row) => row.split(';')[0])).toEqual(['SKU10']);

    fireEvent.click(matrix.getByRole('button', {
      name: 'Восстановить SKU1 во всех подразделениях',
    }));
    await waitFor(() => expect(stupinoQty).toHaveValue(4));
    expect(leninaQty).toHaveValue(7);
    expect(writes[1]).toEqual([]);
  });

  it('shows a confirmed CSV export separately from the order threshold', async () => {
    render(
      <StatefulOrders
        initial={baseState({
          settings: {
            minimumOrderAmount: 500,
            thresholdMode: 'BRANCH_SUPPLIER',
          },
          uiPreferences: { 'orders:belowThreshold': true },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /400,00/ }));
    const drawer = screen.getByRole('dialog', { name: 'Состав заказа' });
    expect(within(drawer).queryByText('Выгружен')).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', {
      name: 'Выгрузить несмотря на порог',
    }));
    const confirm = screen.getByRole('dialog', {
      name: 'Выгрузить заказ ниже порога?',
    });
    fireEvent.click(within(confirm).getByRole('button', {
      name: 'Выгрузить несмотря на порог',
    }));

    await waitFor(() =>
      expect(mocks.downloadCsv).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'Ступино', status: 'BLOCKED' }),
      ),
    );
    expect(await within(drawer).findByText('Выгружен')).toBeVisible();
    expect(within(drawer).getByText('Заказ ниже минимального порога.')).toBeVisible();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Закрыть' }));

    const card = screen.getByRole('button', {
      name: /400,00.*Заблокирован.*Выгружен/i,
    });
    expect(card).toHaveClass('BLOCKED');
    const metric = screen.getByText('Выгружены').closest('.metric');
    expect(metric?.querySelector('strong')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Скачать все (1)' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', {
      name: /все заказы ип баранов роман борисович/i,
    }));
    const supplier = screen.getByRole('dialog', {
      name: /все заказы ип баранов роман борисович/i,
    });
    const branch = within(supplier).getByRole('columnheader', { name: /Ступино/ });
    expect(within(branch).getByText('Выгружен')).toBeVisible();
    expect(within(branch).getByText('Ниже порога')).toBeVisible();
  });

  it('keeps review and export state on a no-op quantity edit', () => {
    const set = vi.fn();
    renderWithStore(
      <OrdersPage />,
      baseState({
        reviewedOrderIds: ['Ленина\0ИП Баранов Роман Борисович'],
        exportedOrderIds: ['Ленина\0ИП Баранов Роман Борисович'],
      }),
      set,
    );

    fireEvent.click(screen.getByRole('button', { name: /проверен.*700,00/i }));
    const input = screen.getByLabelText('Количество SKU1');
    fireEvent.change(input, { target: { value: '7.0' } });

    expect(set).not.toHaveBeenCalled();
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
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось сформировать ZIP с заказами',
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
          'Не удалось сформировать Excel для ИП Баранов Роман Борисович. Повторите выгрузку.',
      }),
    );
  });

  it('does not download a workbook once another tab replaces the revision during generation', async () => {
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = new IDBFactory();
    try {
      const state = baseState({ workspaceRevision: 0 });
      await saveWorkspace(workspaceFromState(state), -1);
      let finish!: (buffer: ArrayBuffer) => void;
      mocks.buildSupplierWorkbook.mockImplementationOnce(
        () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }),
      );
      const commit = vi.fn().mockResolvedValue(undefined);
      render(
        <StoreContext.Provider value={{ state, set: () => undefined, commit }}>
          <OrdersPage />
        </StoreContext.Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: /excel все/i }));
      await saveWorkspace(workspaceFromState({ ...state, workspaceRevision: 1 }), 0);
      finish(new ArrayBuffer(8));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('сеанс изменился'),
      );
      expect(mocks.save).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    } finally {
      globalThis.indexedDB = previousIndexedDB;
    }
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
        suppliers: [
          'ИП Баранов Роман Борисович',
          'ИП Никишин Андрей Николаевич',
        ],
        history: [
          {
            supplier: 'ИП Баранов Роман Борисович',
            skuCode: 'SKU1',
            skuName: 'Товар 1',
            unit: 'шт',
            purchaseQty: 10,
            purchaseAmount: 1000,
            weightedUnitCost: 100,
          },
          {
            supplier: 'ИП Никишин Андрей Николаевич',
            skuCode: 'SKU2',
            skuName: 'Товар 2',
            unit: 'шт',
            purchaseQty: 10,
            purchaseAmount: 500,
            weightedUnitCost: 50,
          },
        ],
      },
      reviewedOrderIds: [
        'Ленина\0ИП Баранов Роман Борисович',
        'Ступино\0ИП Никишин Андрей Николаевич',
      ],
    });
    renderWithStore(<OrdersPage />, state);

    fireEvent.change(screen.getByLabelText(/поиск поставщика/i), {
      target: { value: 'ИП Баранов Роман Борисович' },
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
          reviewedOrderIds: [
            'Ленина\0ИП Баранов Роман Борисович',
            'Ступино\0ИП Баранов Роман Борисович',
          ],
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /все заказы ип баранов роман борисович/i,
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: /все заказы ип баранов роман борисович/i,
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
      screen.getByRole('button', {
        name: /все заказы ип баранов роман борисович/i,
      }),
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
      screen.getByRole('button', {
        name: /все заказы ип баранов роман борисович/i,
      }),
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
          state: baseState({
            reviewedOrderIds: ['Ленина\0ИП Баранов Роман Борисович'],
          }),
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
      reviewedOrderIds: ['Ленина\0ИП Баранов Роман Борисович'],
      minMax: {
        ...baseState().minMax!,
        skus: [{ ...baseState().minMax!.skus[0]!, referencePrice: null }],
      },
      suppliers: {
        suppliers: ['ИП Баранов Роман Борисович'],
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
      screen.getByRole('button', {
        name: /все заказы ип баранов роман борисович/i,
      }),
    ).toHaveClass('has-blocker');
  });

  it('uses a horizontal status line for reviewed manually edited orders', () => {
    renderWithStore(
      <OrdersPage />,
      baseState({
        edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 8 }],
        reviewedOrderIds: ['Ленина\0ИП Баранов Роман Борисович'],
        exportedOrderIds: ['Ленина\0ИП Баранов Роман Борисович'],
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
