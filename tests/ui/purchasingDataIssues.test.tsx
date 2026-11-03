import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { DemandPage } from '../../src/features/demand/DemandPage';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import { baseState, renderWithStore } from './renderWithStore';
import { derive } from '../../src/app/selectors';

describe('persistent purchasing source diagnostics', () => {
  it.each([
    ['network demand', <DemandPage />],
    ['branch demand', <DemandPage branch="Ленина" />],
    ['suppliers', <SuppliersPage />],
    ['orders', <OrdersPage />],
  ])(
    'shows omitted malformed branch on %s independently of search',
    (_name, page) => {
      const state = baseState({
        minMaxIssues: [
          {
            severity: 'ERROR',
            code: 'INVALID_BRANCH_VALUES',
            skuCode: 'SKU1',
            branch: 'Щурово',
            message: 'Некорректный остаток SKU1 / Щурово',
            row: 8,
          },
        ],
      });
      renderWithStore(page, state);
      expect(
        screen.getByText('Расчёт неполный: есть ошибки в MIN/MAX'),
      ).toBeVisible();
      fireEvent.click(screen.getByText(/Показать ошибки MIN\/MAX/));
      expect(
        screen.getByText('Некорректный остаток SKU1 / Щурово'),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Проверить MIN/MAX' }),
      ).toBeEnabled();
    },
  );

  it('does not show a source-error banner for a valid dataset', () => {
    renderWithStore(<OrdersPage />, baseState());
    expect(
      screen.queryByText('Расчёт неполный: есть ошибки в MIN/MAX'),
    ).not.toBeInTheDocument();
  });

  it('blocks export of an ambiguous order while keeping the independent order exportable', () => {
    const state = baseState({
      minMaxIssues: [
        {
          severity: 'ERROR',
          code: 'DUPLICATE_SKU_BRANCH',
          skuCode: 'SKU1',
          branch: 'Ленина',
          message: 'Дубликат SKU1 / Ленина',
        },
      ],
    });
    const projection = derive(state).projection;
    expect(projection.orders.find((o) => o.branch === 'Ленина')!.status).toBe(
      'BLOCKED',
    );
    expect(projection.orders.find((o) => o.branch === 'Ступино')!.status).toBe(
      'READY',
    );
    renderWithStore(<OrdersPage />, state);
    const cell = screen.getByRole('button', {
      name: /Ошибка данных MIN\/MAX: SKU1 \/ Ленина/,
    });
    fireEvent.click(cell);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: /Скачать CSV/ }),
    ).toBeDisabled();
  });
});
