import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ImportPage } from '../../src/features/import/ImportPage';
import { baseState, renderWithStore } from './renderWithStore';
import type { ValidationIssue } from '../../src/domain/types';

it.each([
  ['ERROR', 'Прочитан с ошибками'],
  ['WARNING', 'Прочитан с предупреждениями'],
] as const)('distinguishes a readable MIN/MAX with %s issues from clean data', (severity, label) => {
  const issue: ValidationIssue = { severity, code: 'INVALID_NORM', message: 'Проверьте норматив', skuCode: 'SKU1' };
  renderWithStore(<ImportPage />, baseState({ minMaxIssues: [issue] }));
  const card = screen.getByRole('heading', { name: 'Отчёт MIN/MAX' }).closest('section')!;
  expect(within(card).getByText(label)).toBeVisible();
  expect(within(card).queryByText('Успешно распознан')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Перейти к потребности' })).toBeEnabled();
});

it('keeps the quality warning visible for a locked startup supplier source', () => {
  renderWithStore(<ImportPage />, baseState({ supplierIssues: [{ severity: 'ERROR', code: 'INVALID_BRANCH_VALUES', message: 'Ошибка источника' }] }));
  const card = screen.getByRole('heading', { name: 'Отчёт поставщиков' }).closest('section')!;
  expect(within(card).getByText('Прочитан с ошибками')).toBeVisible();
  expect(within(card).getByText('Использован при первичной настройке')).toBeVisible();
});

it('shows invalid norms from a restored legacy dataset even without saved import diagnostics', () => {
  const state = baseState();
  state.minMax!.branchStocks[0]!.min = -5;
  renderWithStore(<ImportPage />, state);
  const card = screen.getByRole('heading', { name: 'Отчёт MIN/MAX' }).closest('section')!;
  expect(within(card).getByText('Прочитан с ошибками')).toBeVisible();
  expect(within(card).getAllByText(/Отрицательный норматив/)).toHaveLength(1);
});

it('does not let a legacy MIN>MAX warning suppress the new negative-MAX error', () => {
  const state = baseState({ minMaxIssues: [{
    code: 'INVALID_NORM', severity: 'WARNING', skuCode: 'SKU1', branch: 'Ленина', row: 3,
    message: 'MIN больше MAX: SKU1 / Ленина (0 > -5)',
  }] });
  Object.assign(state.minMax!.branchStocks[0]!, { min: 0, max: -5 });
  renderWithStore(<ImportPage />, state);
  const card = screen.getByRole('heading', { name: 'Отчёт MIN/MAX' }).closest('section')!;
  expect(within(card).getByText('Прочитан с ошибками')).toBeVisible();
  expect(within(card).getByText(/Отрицательный норматив/)).toBeVisible();
  expect(within(card).getByText(/MIN больше MAX/)).toBeVisible();
});

it('shows clean imports as successful and never reports success while reading', () => {
  const state = baseState();
  const { unmount } = renderWithStore(<ImportPage />, state);
  const card = screen.getByRole('heading', { name: 'Отчёт MIN/MAX' }).closest('section')!;
  expect(within(card).getByText('Успешно распознан')).toBeVisible();
  unmount();
  renderWithStore(<ImportPage />, { ...state, minMaxLoading: true });
  const busy = screen.getByRole('heading', { name: 'Отчёт MIN/MAX' }).closest('section')!;
  expect(within(busy).getByText('Обработка файла…')).toBeVisible();
  expect(within(busy).queryByText('Успешно распознан')).not.toBeInTheDocument();
});
