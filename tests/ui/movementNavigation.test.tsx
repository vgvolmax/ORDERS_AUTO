import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { App } from '../../src/app/App';
import { derive } from '../../src/app/selectors';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import {
  stateFromWorkspace,
  workspaceFromState,
} from '../../src/app/workspaceSession';
import {
  loadActiveWorkspace,
  saveWorkspace,
} from '../../src/persistence/workspaces';
import { orderToCsv } from '../../src/export/csv';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
function acceptedState(branch: string) {
  let state = rebalanceAppState();
  state.minMax!.skus.push({ ...state.minMax!.skus[0]!, code: 'SKU10' });
  state.minMax!.branchStocks.push(
    ...state.minMax!.branchStocks.map((line) => ({
      ...line,
      skuCode: 'SKU10',
    })),
  );
  state.suppliers!.history.push({
    ...state.suppliers!.history[0]!,
    skuCode: 'SKU10',
  });
  state.rebalance.policies.push({
    skuCode: 'SKU10',
    unit: 'шт',
    quantityStep: 1,
  });
  state.rebalance.proposal = createProposal(state);
  state = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'accept',
      ids: state.rebalance.proposal.transfers.map((t) => t.sourceLineId),
      expectedRevision: 0,
    }).patch,
  };
  state.edits = [{ skuCode: 'SKU1', branch: 'Получатель', qty: 40 }];
  const ids = derive(state).projection.orders.map((order) => order.id);
  state.reviewedOrderIds = ids;
  state.exportedOrderIds = ids;
  state.workspaceRevision = 0;
  state.page = `branch:${branch}`;
  return state;
}
it.each([
  { branch: 'Донор А', id: 'b0', count: 1 },
  { branch: 'Получатель', id: 'b2', count: 2 },
])(
  'keeps exact SKU and either endpoint scope from the $branch popup through reload, with explicit clearing',
  async ({ branch, id, count }) => {
    const initial = acceptedState(branch);
    const payloads = derive(initial).projection.orders.map(orderToCsv);
    await saveWorkspace(workspaceFromState(initial), -1);
    const view = render(<App />);
    await screen.findByRole('heading', { name: branch });
    if (branch === 'Донор А')
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: 'Показать покрытые перемещениями',
        }),
      );
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Учтённые перемещения SKU1 ${branch}`,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть ребалансировку' }),
    );
    await screen.findByRole('heading', { name: 'Ребалансировка' });
    const movementCount = () => {
      let count = 0;
      const triggers = screen.getAllByRole('button', {
        name: /Открыть перемещение/,
      });
      for (const trigger of triggers) {
        fireEvent.click(trigger);
        const drawer = screen.getByRole('dialog', {
          name: 'Состав перемещения',
        });
        count += within(drawer).queryAllByRole('button', {
          name: /Отменить принятие SKU/,
        }).length;
        fireEvent.click(
          within(drawer).getByRole('button', { name: 'Закрыть' }),
        );
      }
      return count;
    };
    expect(movementCount()).toBe(count);
    expect(screen.getByText(`Подразделение: ${branch}`)).toBeVisible();
    const saved = (await loadActiveWorkspace())!;
    expect(saved.data.rebalance.resultScope).toEqual({
      skuCode: 'SKU1',
      branchId: id,
    });
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Ребалансировка' });
    expect(movementCount()).toBe(count);
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(movementCount()).toBe(count * 2);
    expect(screen.getByText(`Подразделение: ${branch}`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(movementCount()).toBe(4);
    await waitFor(() =>
      expect(screen.queryByText('Сохранение сеанса…')).not.toBeInTheDocument(),
    );
    const final = (await loadActiveWorkspace())!;
    expect(final.data.rebalance.accepted).toEqual(initial.rebalance.accepted);
    expect(final.data.rebalance.selectedLineIds).toEqual(
      initial.rebalance.selectedLineIds,
    );
    expect(final.data.edits).toEqual(initial.edits);
    expect(final.data.reviewedOrderIds).toEqual(initial.reviewedOrderIds);
    expect(final.data.exportedOrderIds).toEqual(initial.exportedOrderIds);
    expect(
      derive(stateFromWorkspace(final)).projection.orders.map(orderToCsv),
    ).toEqual(payloads);
  },
);
