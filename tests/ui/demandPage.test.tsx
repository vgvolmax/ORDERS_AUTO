import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemandPage } from '../../src/features/demand/DemandPage';
import { baseState, renderWithStore } from './renderWithStore';

function noNormState() {
  return baseState({
    minMax: {
      skus: [
        {
          code: 'NO-MAX-1',
          article: 'NM-1',
          name: 'Товар без MAX',
          referencePrice: 100,
          reportedTotalStock: 3,
        },
      ],
      branchStocks: [
        {
          skuCode: 'NO-MAX-1',
          branch: 'Ленина',
          stock: 3,
          min: 1,
          max: null,
        },
      ],
      branches: ['Ленина'],
    },
    suppliers: {
      suppliers: [],
      history: [],
    },
  });
}

describe('DemandPage', () => {
  it('shows local and network need, money and price source for a branch', () => {
    renderWithStore(<DemandPage branch="Ленина" />, baseState());

    expect(screen.getByText('Нужно сюда')).toBeInTheDocument();
    expect(screen.getByText('Нужно всей сети')).toBeInTheDocument();
    expect(screen.getByText('₽ сюда')).toBeInTheDocument();
    expect(screen.getByText('₽ всей сети')).toBeInTheDocument();
    expect(screen.getByText('Источник цены')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
  });

  it('shows NO_NORM rows for a branch only when that status is selected', () => {
    renderWithStore(<DemandPage branch="Ленина" />, noNormState());

    expect(screen.queryByText('Товар без MAX')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Статус'), {
      target: { value: 'NO_NORM' },
    });

    expect(screen.getByText('Товар без MAX')).toBeInTheDocument();
  });

  it('shows NO_NORM SKUs in the network view when that status is selected', () => {
    renderWithStore(<DemandPage />, noNormState());

    expect(screen.queryByText('Товар без MAX')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Статус'), {
      target: { value: 'NO_NORM' },
    });

    expect(screen.getByText('Товар без MAX')).toBeInTheDocument();
  });
});
