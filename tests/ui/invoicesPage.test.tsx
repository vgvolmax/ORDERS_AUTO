import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoicesPage } from '../../src/features/invoices/InvoicesPage';
import type { WorkflowOrder } from '../../src/app/selectors';

const { source, verifySource, save, parseInvoiceWorkbook } = vi.hoisted(() => ({
  source: { orders: [] as (WorkflowOrder & { exported: boolean })[] },
  verifySource: vi.fn(async () => {}),
  save: vi.fn(),
  parseInvoiceWorkbook: vi.fn(() => ({
    items: [{
      skuCode: '001',
      article: 'ART',
      name: 'Масло',
      quantity: 4,
      unit: 'шт',
      price: 120,
      amount: 480,
      sourceRow: 2,
    }],
    warnings: [],
  })),
}));

vi.mock('../../src/features/invoices/useInvoiceOrders', () => ({
  useInvoiceOrders: () => ({
    sourceId: 'current',
    sources: [{ id: 'current', label: 'Текущий сеанс' }, { id: 'archive', label: 'Архив' }],
    selectSource: vi.fn(),
    orders: source.orders,
    loading: false,
    error: '',
    verifySource,
  }),
}));
vi.mock('../../src/import/invoiceParser', () => ({ parseInvoiceWorkbook }));
vi.mock('../../src/export/download', () => ({ save }));

function order(id: string, branch: string, supplier = 'Альфа', orderQty = 2) {
  return {
    id, branch, supplier,
    reviewed: true, manualEditCount: 0, exported: false,
    status: 'READY', totalQty: orderQty, totalAmount: orderQty * 100,
    belowThreshold: false, blockers: [],
    lines: [{
      skuCode: '001', article: 'ART', name: 'Масло', unit: 'шт',
      branch, supplier, calculatedQty: 2, orderQty, unitPrice: 100,
      priceSource: 'MIN_MAX', amount: orderQty * 100, warnings: [],
      stock: 0, min: 1, max: 2,
    }],
  } satisfies WorkflowOrder & { exported: boolean };
}

function selectFile(arrayBuffer = async () => new ArrayBuffer(0)) {
  const file = new File([], 'invoice.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
  fireEvent.change(screen.getByLabelText('Файл счёта поставщика'), {
    target: { files: [file] },
  });
}

async function compare() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сравнить' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
  return screen.findByRole('heading', { name: 'Результат сверки' });
}

describe('InvoicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    source.orders = [order('a', 'Склад 1'), order('b', 'Склад 2'), order('c', 'Склад 3', 'Бета')];
  });

  it('selects multiple branch orders of one supplier and exports only after comparing', async () => {
    render(<InvoicesPage initialOrderIds={['a']} />);
    expect(screen.getByRole('checkbox', { name: 'Выбрать заказ Альфа — Склад 1' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать заказ Альфа — Склад 2' }));
    expect(screen.getByRole('checkbox', { name: 'Выбрать заказ Бета — Склад 3' })).toBeDisabled();
    selectFile();
    await compare();
    expect(screen.getAllByText('Дороже').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'CSV для 1С' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.csv$/)));
  });

  it('blocks stale exports and keeps edited corrections until the operator chooses to replace them', async () => {
    const view = render(<InvoicesPage initialOrderIds={['a']} />);
    selectFile();
    await compare();
    fireEvent.change(screen.getByRole('textbox', { name: /Количество.*ART/ }), {
      target: { value: '3,5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Снять выбор' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByRole('textbox', { name: /Количество.*ART/ })).toHaveValue('3,5');

    source.orders = [order('a', 'Склад 1', 'Альфа', 3)];
    view.rerender(<InvoicesPage initialOrderIds={['a']} />);
    expect(screen.queryByRole('button', { name: 'CSV для 1С' })).not.toBeInTheDocument();
    expect(screen.getByText(/Заказы изменились/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores an upload that finishes after the order selection is cleared', async () => {
    render(<InvoicesPage initialOrderIds={['a']} />);
    let finish!: (buffer: ArrayBuffer) => void;
    selectFile(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Снять выбор' }));
    await act(async () => finish(new ArrayBuffer(0)));
    expect(screen.getByRole('button', { name: 'Сравнить' })).toBeDisabled();
    expect(parseInvoiceWorkbook).not.toHaveBeenCalled();
  });

  it('rejects an export if the current saved session has changed', async () => {
    render(<InvoicesPage initialOrderIds={['a']} />);
    selectFile();
    await compare();
    verifySource.mockRejectedValueOnce(new Error('Сеанс изменился.'));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать результат CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеанс изменился.');
    expect(screen.queryByRole('heading', { name: 'Результат сверки' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('validates edited numbers and clears the dirty indicator only after correction export', async () => {
    const onDirtyChange = vi.fn();
    render(<InvoicesPage initialOrderIds={['a']} onDirtyChange={onDirtyChange} />);
    selectFile();
    await compare();
    const qty = screen.getByRole('textbox', { name: /Количество.*ART/ });
    const exportButton = screen.getByRole('button', { name: 'CSV для 1С' });
    fireEvent.change(qty, { target: { value: '1 2' } });
    expect(qty).toHaveAttribute('aria-invalid', 'true');
    expect(exportButton).toBeDisabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.change(qty, { target: { value: '0' } });
    fireEvent.click(exportButton);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('blocks adjustment export if an included invoice row has neither article nor name', async () => {
    const item = parseInvoiceWorkbook().items[0]!;
    parseInvoiceWorkbook.mockReturnValueOnce({
      items: [item, { ...item, skuCode: '002', article: '', name: '', sourceRow: 3 }],
      warnings: [],
    });
    render(<InvoicesPage initialOrderIds={['a']} />);
    selectFile();
    await compare();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Включить в экспорт 002' }));
    expect(screen.getByRole('button', { name: 'CSV для 1С' })).toBeDisabled();
    expect(screen.getByText(/Исключите из экспорта позиции без артикула и наименования/)).toBeInTheDocument();
  });
  it('blocks every 1C export format until conflicting checked positions are resolved', async () => {
    const item = parseInvoiceWorkbook().items[0]!;
    parseInvoiceWorkbook.mockReturnValueOnce({
      items: [item, { ...item, skuCode: '002', sourceRow: 3 }],
      warnings: [],
    });
    render(<InvoicesPage initialOrderIds={['a']} />);
    selectFile();
    await compare();
    fireEvent.click(screen.getByRole('checkbox', { name: /Включить в экспорт.*002/ }));
    expect(screen.getByText(/неразличимы.*1С/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV для 1С' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Excel для 1С' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скопировать для 1С' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Включить в экспорт.*002/ }));
    expect(screen.getByRole('button', { name: 'CSV для 1С' })).toBeEnabled();
  });

});
