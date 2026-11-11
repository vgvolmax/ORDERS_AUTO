import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createProposal } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { ResultsTable } from '../../src/features/rebalancing/ResultsTable';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

function resultsProps() {
  const state = rebalanceAppState();
  const proposal = createProposal(state);
  const pending = proposal.transfers[0]!;
  const secondSku = { ...state.minMax!.skus[0]!, code: 'SKU10' };
  const extra = { ...pending, sourceLineId: 'second', skuCode: secondSku.code };
  const accepted = {
    ...pending,
    transferId: 'accepted',
    sourceRunId: proposal.runId,
    snapshotId: proposal.snapshotId,
    acceptedAt: '2026-11-11',
    acceptedConfig: proposal.config,
  };
  const action = vi.fn();
  return {
    proposal: { ...proposal, transfers: [...proposal.transfers, extra] },
    accepted: [accepted],
    registry: state.rebalance.registry,
    policies: state.rebalance.policies,
    skus: [...state.minMax!.skus, secondSku],
    snapshot: derive(state).snapshot!.snapshot,
    selected: [],
    rejected: [],
    query: '',
    scope: {},
    onQuery: action,
    onClearScope: action,
    onSelection: action,
    onReject: action,
    onRevoke: action,
    onAccept: action,
    onExport: action,
    stale: false,
    busy: false,
  };
}

const donorA = () =>
  screen.getByRole('button', {
    name: 'Открыть перемещение Донор А → Получатель',
  });

it('uses decisions in the full route when a search hides pending or accepted positions', () => {
  const props = resultsProps();
  const { rerender } = render(<ResultsTable {...props} scope={{ skuCode: 'SKU1' }} />);
  expect(donorA()).not.toHaveClass('is-reviewed');
  expect(donorA()).not.toHaveClass('is-rejected');
  expect(donorA()).toHaveTextContent('Предложено: 1');

  rerender(<ResultsTable {...props} query="SKU10" rejected={['second']} />);
  expect(donorA()).toHaveClass('is-reviewed');
  expect(within(donorA()).getByText('Отклонено: 1')).toHaveClass('danger-text');

  rerender(
    <ResultsTable
      {...props}
      accepted={[]}
      rejected={[props.accepted[0]!.sourceLineId, 'second']}
      query="SKU10"
    />,
  );
  expect(donorA()).toHaveClass('is-rejected');
  expect(within(donorA()).getByText('Отклонено: 2')).toHaveClass('danger-text');
});

it('opens exact-code directions outside the search and restores focus on Escape', () => {
  const props = resultsProps();
  render(<ResultsTable {...props} scope={{ branchId: 'b0' }} />);
  fireEvent.click(donorA());
  const drawer = screen.getByRole('dialog', { name: 'Состав перемещения' });
  const link = within(drawer).getByRole('button', { name: 'Направления 2 для SKU1' });
  expect(link).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('dialog', { name: 'Направления товара SKU1' })).toBeNull();

  fireEvent.change(within(drawer).getByRole('textbox', { name: 'Поиск по составу перемещения' }), {
    target: { value: 'SKU1' },
  });
  fireEvent.click(link);
  const popup = screen.getByRole('dialog', { name: 'Направления товара SKU1' });
  expect(link).toHaveAttribute('aria-expanded', 'true');
  expect(popup).toHaveTextContent('Донор А → Получатель');
  expect(popup).toHaveTextContent('Текущее направление');
  expect(popup).toHaveTextContent('15 шт');
  expect(popup).toHaveTextContent('Принято');
  expect(popup).toHaveTextContent('Донор Б → Получатель');
  expect(popup).toHaveTextContent('35 шт');
  expect(popup).toHaveTextContent('Предложено');
  expect(popup).not.toHaveTextContent('SKU10');
  expect(within(popup).getByRole('button', { name: 'Закрыть направления' })).toHaveFocus();

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(popup).not.toBeInTheDocument();
  expect(drawer).toBeInTheDocument();
  expect(link).toHaveFocus();
});

it('previews an advisory warning, enforces the physical limit and preserves an unsaved quantity after failure', async () => {
  const props = resultsProps();
  const save = vi.fn().mockRejectedValueOnce(new Error('Ошибка сохранения')).mockResolvedValue(undefined);
  render(
    <ResultsTable
      {...props}
      accepted={[]}
      onEditQuantity={save}
      quantityDetails={(_, qty = 15) => ({
        maxQty: 60,
        reservedOtherQty: 15,
        originalQty: 15,
        donorAfter: 60 - qty,
        recipientAfter: 10 + qty,
        donorMax: 60,
        recipientMax: 60,
        recipientTarget: 50,
        amount: qty * 100,
        amountThreshold: 2000,
        belowAmountThreshold: qty < 20,
      })}
    />,
  );
  fireEvent.click(donorA());
  const drawer = within(screen.getByRole('dialog', { name: 'Состав перемещения' }));
  const quantity = drawer.getByRole('spinbutton', { name: 'Количество SKU1' });
  const change = (value: string) => fireEvent.change(quantity, { target: { value } });
  const saveButton = () => drawer.getByRole('button', { name: 'Сохранить количество SKU1' });
  expect(quantity).toHaveValue(15);
  fireEvent.click(drawer.getByRole('button', { name: 'Направления 2 для SKU1' }));
  const popup = screen.getByRole('dialog', { name: 'Направления товара SKU1' });
  expect(
    within(popup).getByText('Зарезервировано на другие направления:').nextElementSibling,
  ).toHaveTextContent('15 шт');
  expect(
    within(popup).getByText('Максимум для этого направления:').nextElementSibling,
  ).toHaveTextContent('60 шт');
  fireEvent.keyDown(document, { key: 'Escape' });

  change('61');
  expect(saveButton()).toBeDisabled();
  expect(quantity).toHaveAttribute('aria-invalid', 'true');
  expect(drawer.getByRole('alert')).toHaveTextContent('Максимум для этого направления: 60 шт');

  change('51');
  expect(drawer.getByText(/Остаток отправителя ниже MAX/)).toBeInTheDocument();
  expect(drawer.getByText(/Остаток получателя выше MAX/)).toBeInTheDocument();
  expect(saveButton()).toBeEnabled();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(saveButton());
  await waitFor(() => expect(drawer.getByRole('alert')).toHaveTextContent('Ошибка сохранения'));
  expect(quantity).toHaveValue(51);

  change('16');
  expect(drawer.getByText(/Сумма ниже порога/)).toBeInTheDocument();
  fireEvent.click(saveButton());
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(props.accepted[0]!.sourceLineId, 16));
});
