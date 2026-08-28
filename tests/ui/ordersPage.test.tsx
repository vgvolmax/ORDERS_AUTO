import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrdersPage } from '../../src/features/orders/OrdersPage';
import { baseState, renderWithStore } from './renderWithStore';

describe('OrdersPage', () => {
  it('shows a supplier-total column in the order matrix', () => {
    renderWithStore(<OrdersPage />, baseState());
    expect(screen.getByText('Итого поставщику')).toBeInTheDocument();
  });
});
