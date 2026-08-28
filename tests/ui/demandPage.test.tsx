import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemandPage } from '../../src/features/demand/DemandPage';
import { baseState, renderWithStore } from './renderWithStore';

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
});
