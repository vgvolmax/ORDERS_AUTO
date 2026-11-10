import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StoreContext } from '../../src/app/appStore';
import { createProposal, prepareAcceptedChange } from '../../src/app/rebalanceActions';
import { workspaceFromState } from '../../src/app/workspaceSession';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import * as downloads from '../../src/export/download';
import { readActiveWorkspaceRevision, saveWorkspace } from '../../src/persistence/workspaces';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

afterEach(() => vi.restoreAllMocks());

it('blocks stale accepted CSVs and Excel after a second tab revokes the transfer', async () => {
  const initial = rebalanceAppState();
  initial.rebalance.proposal = createProposal(initial);
  const state = {
    ...initial,
    ...prepareAcceptedChange(initial, {
      kind: 'accept',
      ids: [initial.rebalance.proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
    workspaceRevision: 0,
  };
  await saveWorkspace(workspaceFromState(state), -1);
  const revoked = {
    ...state,
    ...prepareAcceptedChange(state, {
      kind: 'revoke',
      ids: state.rebalance.accepted.map((t) => t.transferId),
      expectedRevision: 1,
    }).patch,
    workspaceRevision: 1,
  };
  await saveWorkspace(workspaceFromState(revoked), 0);
  expect(await readActiveWorkspaceRevision()).toEqual({
    workspaceId: state.workspaceId,
    revision: 1,
  });

  const acceptedCsv = vi.spyOn(downloads, 'downloadAcceptedTransfersCsv').mockImplementation(() => undefined);
  const resultCsv = vi.spyOn(downloads, 'downloadTransferCsv').mockImplementation(() => undefined);
  const excel = vi.spyOn(downloads, 'save').mockImplementation(() => undefined);
  const commit = vi.fn();
  const renderPage = (tab: 'accepted' | 'results') => (
    <StoreContext.Provider value={{
      state: { ...state, rebalance: { ...state.rebalance, tab } },
      commit,
      set: vi.fn(),
    }}>
      <RebalancingPage />
    </StoreContext.Provider>
  );
  const { rerender } = render(renderPage('accepted'));
  const reject = async (button: HTMLElement, probe: typeof acceptedCsv | typeof resultCsv | typeof excel) => {
    fireEvent.click(button);
    await waitFor(() => {
      expect(probe).not.toHaveBeenCalled();
      expect(screen.getAllByRole('alert').some((alert) =>
        alert.textContent?.includes('Обновите страницу'))).toBe(true);
      expect(button).toBeEnabled();
    });
  };

  await reject(screen.getByRole('button', { name: 'CSV Донор А → Получатель' }), acceptedCsv);
  await reject(screen.getByRole('button', { name: 'Excel перемещений' }), excel);
  rerender(renderPage('results'));
  fireEvent.click(screen.getByRole('button', { name: 'Открыть перемещение Донор А → Получатель' }));
  await reject(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Скачать CSV принятых позиций (1)' }),
    resultCsv,
  );
});
