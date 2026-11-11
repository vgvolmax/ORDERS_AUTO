import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { InvoicesPage } from '../../src/features/invoices/InvoicesPage';

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../src/export/download', () => ({ save }));
vi.mock('../../src/features/invoices/useInvoiceOrders', () => ({
  useInvoiceOrders: () => ({
    sourceId: 'current', sources: [{ id: 'current', label: 'Текущий сеанс' }],
    selectSource: vi.fn(), verifySource: async () => {}, loading: false, error: '', historyError: '', skuCodes: ['0001'],
    orders: [{
      id: 'o', supplier: 'Альфа', branch: 'Склад', reviewed: true, exported: false,
      totalAmount: 1000, totalQty: 10, status: 'READY', blockers: [], belowThreshold: false,
      manualEditCount: 0,
      lines: [{ skuCode: '0001', article: '000123', name: 'Кран', unit: 'шт', orderQty: 10,
        calculatedQty: 10, unitPrice: 100, amount: 1000, priceSource: 'MIN_MAX',
        branch: 'Склад', supplier: 'Альфа', stock: 0, min: 2, max: 10, warnings: [] }],
    }],
  }),
}));

const header = ['Код 1С', 'Артикул', 'Наименование', 'Количество', 'Ед. измерения', 'Цена', 'Сумма'];
function upload(sheets: unknown[][][]) {
  const book = XLSX.utils.book_new();
  sheets.forEach((rows, i) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Часть ' + (i + 1)));
  const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], 'счёт.xlsx');
  fireEvent.change(screen.getByLabelText('Файл счёта поставщика'), { target: { files: [file] } });
}
beforeEach(() => vi.clearAllMocks());

it('compares only explicitly chosen sheets and preserves the combined invoice quantity', async () => {
  render(<InvoicesPage initialOrderIds={['o']} />);
  upload([
    [header, ['0001', '000123', 'Кран', 4, 'шт', 100, 400]],
    [header, ['0001', '000123', 'Кран', 6, 'шт', 100, 600]],
  ]);
  const sheets = await screen.findByRole('group', { name: 'Листы счёта' });
  const apply = within(sheets).getByRole('button', { name: 'Использовать выбранные листы' });
  expect(apply).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Сравнить' })).toBeDisabled();
  fireEvent.click(within(sheets).getByRole('checkbox', { name: /Часть 1/ }));
  fireEvent.click(within(sheets).getByRole('checkbox', { name: /Часть 2/ }));
  fireEvent.click(apply);
  fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
  await screen.findByRole('heading', { name: 'Результат сверки' });
  expect(screen.getByRole('textbox', { name: /Количество.*000123/ })).toHaveValue('10');
  expect(screen.getByRole('checkbox', { name: /Включить в экспорт.*000123/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'CSV для 1С' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
});

it('guards manual corrections when changing the selected sheets', async () => {
  render(<InvoicesPage initialOrderIds={['o']} />);
  upload([
    [header, ['0001', '000123', 'Кран', 4, 'шт', 100, 400]],
    [header, ['0001', '000123', 'Кран', 6, 'шт', 100, 600]],
  ]);
  const sheets = await screen.findByRole('group', { name: 'Листы счёта' });
  fireEvent.click(within(sheets).getByRole('checkbox', { name: /Часть 1/ }));
  fireEvent.click(within(sheets).getByRole('button', { name: 'Использовать выбранные листы' }));
  fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
  await screen.findByRole('heading', { name: 'Результат сверки' });
  fireEvent.change(screen.getByRole('textbox', { name: /Количество.*000123/ }), { target: { value: '7' } });
  fireEvent.click(within(sheets).getByRole('checkbox', { name: /Часть 2/ }));
  const confirm = screen.getByRole('dialog');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
  expect(screen.getByRole('textbox', { name: /Количество.*000123/ })).toHaveValue('7');
  expect(within(sheets).getByRole('checkbox', { name: /Часть 2/ })).not.toBeChecked();
  fireEvent.click(within(sheets).getByRole('checkbox', { name: /Часть 2/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Изменить листы' }));
  expect(screen.queryByRole('heading', { name: 'Результат сверки' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Сравнить' })).toBeDisabled();
  fireEvent.click(within(sheets).getByRole('button', { name: 'Использовать выбранные листы' }));
  fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
  await screen.findByRole('heading', { name: 'Результат сверки' });
  expect(screen.getByRole('textbox', { name: /Количество.*000123/ })).toHaveValue('10');
});

it('shows a damaged invoice part instead of silently dropping its unreadable quantity', async () => {
  render(<InvoicesPage initialOrderIds={['o']} />);
  upload([
    [header, ['0001', '000123', 'Кран', 4, 'шт', 100, 400]],
    [header, ['0001', '000123', 'Кран', 'ошибка', 'шт', 100, null]],
  ]);
  const sheets = await screen.findByRole('group', { name: 'Листы счёта' });
  expect(within(sheets).getByRole('checkbox', { name: /Часть 2/ })).toBeDisabled();
  expect(within(sheets).getByText(/нет распознанных позиций/i)).toBeInTheDocument();
  fireEvent.click(within(sheets).getByRole('checkbox', { name: /Часть 1/ }));
  fireEvent.click(within(sheets).getByRole('button', { name: 'Использовать выбранные листы' }));
  expect(screen.getByText(/Лист «Часть 2».*количество/i)).toBeInTheDocument();
});

it.each(['упак', null])('does not automatically export a comparison with invoice unit %s', async (unit) => {
  render(<InvoicesPage initialOrderIds={['o']} />);
  upload([[header, ['0001', '000123', 'Кран', 10, unit, 100, 1000]]]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сравнить' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
  await screen.findByRole('heading', { name: 'Результат сверки' });
  for (const checkbox of screen.getAllByRole('checkbox', { name: /Включить в экспорт/ })) {
    expect(checkbox).not.toBeChecked();
  }
  expect(screen.getByRole('button', { name: 'CSV для 1С' })).toBeDisabled();
});
