import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import type { DocSummary, WorkingDocumentBridge, WorkingSession } from '../../src/appbox/documentValue';

const current: WorkingSession = {
  id: 'current', title: 'Закупки · MIN-MAX 20 ноября', updatedAt: Date.UTC(2026, 10, 20),
};
const next: WorkingSession = {
  id: 'next', title: 'Закупки · MIN-MAX 27 ноября', updatedAt: Date.UTC(2026, 10, 27),
};

function setup(team = true) {
  const document: DocSummary = {
    id: current.id, title: current.title, role: 'view', revision: 1,
    ...(team && { workspace: { id: 'team', name: 'Отдел закупки' } }),
  };
  const bridge = {
    read: vi.fn<WorkingDocumentBridge['read']>().mockResolvedValue({ document, records: [], next: null }),
    source: vi.fn<WorkingDocumentBridge['source']>().mockRejectedValue({ code: 'DOCUMENT_SOURCE_UNAVAILABLE' }),
    listSessions: vi.fn<NonNullable<WorkingDocumentBridge['listSessions']>>(),
    openSession: vi.fn<NonNullable<WorkingDocumentBridge['openSession']>>().mockImplementation(async (input) => input),
    readSession: vi.fn<NonNullable<WorkingDocumentBridge['readSession']>>(),
    command: vi.fn<WorkingDocumentBridge['command']>(),
    openOrCreate: vi.fn<WorkingDocumentBridge['openOrCreate']>(),
  } satisfies WorkingDocumentBridge;
  vi.stubGlobal('AppBoxWorkingDocument', bridge);
  return bridge;
}

async function showHistory() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'История сеансов' }));
  expect(await screen.findByRole('heading', { name: 'История сеансов' })).toBeVisible();
}

afterEach(() => vi.unstubAllGlobals());

it('lists every accessible AppBox session and opens a selected document from inside Boost', async () => {
  const bridge = setup();
  bridge.listSessions
    .mockResolvedValueOnce({ items: [current], next: 'page-2' })
    .mockResolvedValueOnce({ items: [current, next], next: null });
  await showHistory();

  const table = await screen.findByRole('table');
  expect(within(table).getAllByText(current.title)).toHaveLength(1);
  const currentRow = within(table).getByText(current.title).closest<HTMLElement>('[role="row"]')!;
  expect(within(currentRow).getByText('Текущий сеанс')).toBeVisible();
  expect(within(currentRow).queryByRole('button')).not.toBeInTheDocument();
  expect(bridge.listSessions.mock.calls).toEqual([[{ limit: 50 }], [{ after: 'page-2', limit: 50 }]]);

  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск по названию или дате обновления' }), {
    target: { value: '27 ноября' },
  });
  expect(within(table).queryByText(current.title)).not.toBeInTheDocument();
  fireEvent.click(within(table).getByRole('button', { name: `Открыть ${next.title}` }));
  await waitFor(() => {
    expect(bridge.openSession).toHaveBeenCalledTimes(1);
    expect(bridge.openSession).toHaveBeenCalledWith({ documentId: next.id });
    expect(within(table).getByRole('button', { name: `Открыть ${next.title}` })).toBeEnabled();
  });
  expect(bridge.readSession).not.toHaveBeenCalled();
  expect(bridge.command).not.toHaveBeenCalled();
  expect(bridge.openOrCreate).not.toHaveBeenCalled();
});

it('recovers from list and open failures without dropping the sessions', async () => {
  const bridge = setup();
  bridge.listSessions
    .mockRejectedValueOnce(new Error('Temporary list failure'))
    .mockResolvedValueOnce({ items: [next], next: null });
  bridge.openSession.mockRejectedValueOnce(new Error('Temporary open failure'));
  await showHistory();
  expect(await screen.findByText('Не удалось загрузить список сеансов.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));

  const open = await screen.findByRole('button', { name: `Открыть ${next.title}` });
  fireEvent.click(open);
  expect(await screen.findByText('Не удалось открыть сеанс. Попробуйте ещё раз.')).toBeVisible();
  expect(open).toBeEnabled();
  fireEvent.click(open);
  await waitFor(() => expect(open).toBeEnabled());
  expect(bridge.openSession).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Не удалось открыть сеанс. Попробуйте ещё раз.')).not.toBeInTheDocument();
});

it('explains when a personal document has no team session list', async () => {
  const bridge = setup(false);
  await showHistory();
  expect(screen.getByText('Список общих сеансов доступен из командного документа Буста.')).toBeVisible();
  expect(bridge.listSessions).not.toHaveBeenCalled();
});

it('keeps an AppBox navigation fallback when the installed SDK cannot open team sessions', async () => {
  const { openSession: _openSession, ...bridge } = setup();
  vi.stubGlobal('AppBoxWorkingDocument', bridge);
  await showHistory();
  expect(await screen.findByText(/требуется обновление AppBox/)).toHaveTextContent('Моих документах');
  expect(bridge.listSessions).not.toHaveBeenCalled();
});
