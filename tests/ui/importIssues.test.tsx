import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportPage } from '../../src/features/import/ImportPage';
import type { ValidationIssue } from '../../src/domain/types';
import { baseState, renderWithStore } from './renderWithStore';

function issues(count: number): ValidationIssue[] {
  return Array.from({ length: count }, (_, index) => ({
    severity: index % 2 === 0 ? 'ERROR' : 'WARNING',
    code: 'INVALID_BRANCH_VALUES',
    message: `Проблема строки ${index + 1}`,
    row: index + 20,
    skuCode: `SKU-${String(index + 1).padStart(3, '0')}`,
    branch: index === count - 1 ? 'Раменское' : 'Ленина',
  }));
}

describe('complete import diagnostics', () => {
  it('exposes every message beyond the old preview with row, SKU and branch context', () => {
    renderWithStore(<ImportPage />, baseState({ minMaxIssues: issues(12) }));
    expect(screen.getByText('Проблема строки 12')).toBeInTheDocument();
    expect(screen.getByText('SKU-012')).toBeInTheDocument();
    expect(screen.getByText('Раменское')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.queryByText(/Ещё сообщений/)).not.toBeInTheDocument();
  });

  it('finds the final message in a virtualized list and combines search with severity', () => {
    renderWithStore(<ImportPage />, baseState({ minMaxIssues: issues(130) }));
    const search = screen.getByRole('textbox', { name: 'Поиск сообщений: Отчёт MIN/MAX' });
    fireEvent.change(search, { target: { value: 'SKU-130' } });
    expect(screen.getByText('Проблема строки 130')).toBeInTheDocument();
    expect(screen.getByText('Показано: 1 из 130')).toBeInTheDocument();
    const severity = screen.getByRole('combobox', { name: 'Важность сообщений: Отчёт MIN/MAX' });
    fireEvent.change(severity, { target: { value: 'ERROR' } });
    expect(screen.getByText('Нет сообщений по выбранным фильтрам.')).toBeInTheDocument();
    expect(screen.getByText('Показано: 0 из 130')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'Ленина' } });
    expect(screen.getByText('Показано: 65 из 130')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '20' } });
    expect(screen.getByText('Проблема строки 1')).toBeInTheDocument();
  });

  it('keeps filters independent for the two reports and handles identical messages', () => {
    const duplicate = { ...issues(1)[0]!, message: 'Одинаковое сообщение' };
    renderWithStore(<ImportPage />, baseState({
      minMaxIssues: [duplicate, duplicate],
      supplierIssues: issues(8),
    }));
    expect(screen.getAllByText('Одинаковое сообщение')).toHaveLength(2);
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск сообщений: Отчёт MIN/MAX' }), {
      target: { value: 'не существует' },
    });
    expect(screen.queryByText('Одинаковое сообщение')).not.toBeInTheDocument();
    const supplier = screen.getByRole('heading', { name: 'Отчёт поставщиков' }).closest('section')!;
    expect(within(supplier).getByText('Проблема строки 8')).toBeInTheDocument();
  });
});
