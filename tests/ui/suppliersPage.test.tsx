import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { baseState, renderWithStore } from './renderWithStore';

describe('SuppliersPage', () => {
  it('shows below-MIN count and never presents an incomplete amount as complete', () => {
    const state = baseState({
      minMax: {
        skus: [
          {
            code: 'SKU1',
            article: 'A-1',
            name: 'Товар 1',
            referencePrice: null,
            reportedTotalStock: 3,
          },
        ],
        branchStocks: [
          { skuCode: 'SKU1', branch: 'Ленина', stock: 3, min: 5, max: 10 },
        ],
        branches: ['Ленина'],
      },
      suppliers: {
        suppliers: ['Поставщик А'],
        history: [
          {
            supplier: 'Поставщик А',
            skuCode: 'SKU1',
            skuName: 'Товар 1',
            unit: 'шт',
            purchaseQty: 0,
            purchaseAmount: 0,
            weightedUnitCost: null,
          },
        ],
      },
    });

    renderWithStore(<SuppliersPage />, state);

    expect(screen.getByText('SKU ниже MIN')).toBeInTheDocument();
    expect(screen.getByText(/сумма неизвестна/i)).toBeInTheDocument();
  });
});
