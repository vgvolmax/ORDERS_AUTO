import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  buildAcceptedDocuments,
  filterAcceptedDocuments,
  emptyAcceptedFilters,
} from '../../src/features/rebalancing/acceptedTransfersViewModel';
import { AcceptedTransfersView } from '../../src/features/rebalancing/AcceptedTransfersView';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import type { AcceptedTransferFilters } from '../../src/domain/workspace';

function documents() {
  let s = rebalanceAppState();
  s.rebalance.proposal = createProposal(s);
  s = {
    ...s,
    ...prepareAcceptedChange(s, {
      kind: 'accept',
      ids: s.rebalance.proposal.transfers.map((t) => t.sourceLineId),
      expectedRevision: 0,
    }).patch,
  };
  return buildAcceptedDocuments({
    accepted: s.rebalance.accepted,
    registry: s.rebalance.registry,
    policies: s.rebalance.policies,
    skus: s.minMax!.skus,
    snapshot: derive(s).snapshot!.snapshot,
  });
}

it('finds whole documents by SKU without truncating their accepted composition', () => {
  const docs = documents();
  docs[0]!.lines.push({
    ...docs[0]!.lines[0]!,
    skuCode: 'OTHER',
    name: 'Другой товар',
  });
  expect(
    filterAcceptedDocuments(docs, { ...emptyAcceptedFilters, query: 'OTHER' }),
  ).toEqual([docs[0]]);
  expect(
    filterAcceptedDocuments(docs, {
      ...emptyAcceptedFilters,
      query: 'OTHER',
    })[0]!.lines,
  ).toHaveLength(2);
  expect(
    filterAcceptedDocuments(docs, {
      ...emptyAcceptedFilters,
      fromBranchId: docs[1]!.fromBranchId,
    }),
  ).toEqual([docs[1]]);
  expect(
    filterAcceptedDocuments(docs, {
      ...emptyAcceptedFilters,
      toBranchId: 'missing',
    }),
  ).toEqual([]);
});

it('projects only committed accepted movements even when the proposal contains other donors', () => {
  const s = rebalanceAppState();
  s.rebalance.proposal = createProposal(s);
  const partial = {
    ...s,
    ...prepareAcceptedChange(s, {
      kind: 'accept',
      ids: [s.rebalance.proposal.transfers[0]!.sourceLineId],
      expectedRevision: 0,
    }).patch,
  };
  const docs = buildAcceptedDocuments({
    accepted: partial.rebalance.accepted,
    registry: s.rebalance.registry,
    policies: s.rebalance.policies,
    skus: s.minMax!.skus,
    snapshot: derive(partial).snapshot!.snapshot,
  });
  expect(docs).toHaveLength(1);
  expect(docs[0]!.lines.map((l) => [l.qty, l.decision])).toEqual([
    [15, 'ACCEPTED'],
  ]);
});

it('filters directions, retains hidden export selection and exports complete selected routes', () => {
  const docs = documents(),
    exportCsv = vi.fn();
  function Harness() {
    const [filters, setFilters] =
      useState<AcceptedTransferFilters>(emptyAcceptedFilters);
    return (
      <AcceptedTransfersView
        documents={docs}
        filters={filters}
        onFilters={setFilters}
        onExport={exportCsv}
      />
    );
  }
  render(<Harness />);
  expect(
    screen.getByRole('heading', { name: 'Принятые перемещения · 2' }),
  ).toBeVisible();
  fireEvent.click(screen.getByLabelText('Выбрать все направления по фильтрам'));
  fireEvent.change(screen.getByLabelText('Отправитель принятых'), {
    target: { value: docs[0]!.fromBranchId },
  });
  expect(screen.getByText(/Скрыто фильтрами: 1/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'CSV выбранных (2)' }));
  expect(exportCsv).toHaveBeenLastCalledWith(docs.map((d) => d.id));
  fireEvent.click(
    screen.getByRole('button', {
      name: `CSV ${docs[0]!.fromName} → ${docs[0]!.toName}`,
    }),
  );
  expect(exportCsv).toHaveBeenLastCalledWith([docs[0]!.id]);
  fireEvent.click(
    screen.getByRole('button', { name: 'Сбросить фильтры принятых' }),
  );
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
});

it('opens a read-only composition and clears a search with keyboard focus retained', () => {
  const docs = documents();
  function Harness() {
    const [filters, setFilters] =
      useState<AcceptedTransferFilters>(emptyAcceptedFilters);
    return (
      <AcceptedTransfersView
        documents={docs}
        filters={filters}
        onFilters={setFilters}
        onExport={() => undefined}
      />
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Поиск принятых перемещений'), {
    target: { value: 'SKU1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(screen.getByLabelText('Поиск принятых перемещений')).toHaveValue('');
  expect(screen.getByLabelText('Поиск принятых перемещений')).toHaveFocus();
  fireEvent.click(
    screen.getByRole('button', {
      name: `Состав ${docs[0]!.fromName} → ${docs[0]!.toName}`,
    }),
  );
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('SKU1', { exact: true })).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: /Принять|Отменить принятие/ }),
  ).not.toBeInTheDocument();
});

it('shows accepted-only empty state with exports disabled', () => {
  render(
    <AcceptedTransfersView
      documents={[]}
      filters={emptyAcceptedFilters}
      onFilters={() => undefined}
      onExport={() => undefined}
    />,
  );
  expect(
    screen.getByText(
      'Принятых перемещений пока нет. Примите предложения на вкладке «Результаты».',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'CSV выбранных (0)' }),
  ).toBeDisabled();
});
it('preserves export selection and shows a recoverable error when a download fails', () => {
  const docs = documents();
  let fail = true;
  const download = () => {
    if (fail) throw new Error('download unavailable');
  };
  render(
    <AcceptedTransfersView
      documents={docs}
      filters={emptyAcceptedFilters}
      onFilters={() => undefined}
      onExport={download}
    />,
  );
  fireEvent.click(screen.getByLabelText('Выбрать все направления по фильтрам'));
  fireEvent.click(screen.getByRole('button', { name: 'CSV выбранных (2)' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось скачать CSV');
  expect(
    screen.getByRole('button', { name: 'CSV выбранных (2)' }),
  ).toBeEnabled();
  expect(
    screen.getByLabelText('Выбрать все направления по фильтрам'),
  ).toBeChecked();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'CSV выбранных (2)' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps unknown route money distinct from known zero and removes vanished routes from selection', () => {
  const docs = documents();
  docs[0]!.totalAmount = null;
  docs[1]!.totalAmount = 0;
  const { rerender } = render(
    <AcceptedTransfersView
      documents={docs}
      filters={emptyAcceptedFilters}
      onFilters={() => undefined}
      onExport={() => undefined}
    />,
  );
  const unknownRow = screen
    .getByLabelText(`Выбрать ${docs[0]!.fromName} → ${docs[0]!.toName}`)
    .closest('[role="row"]')!;
  const zeroRow = screen
    .getByLabelText(`Выбрать ${docs[1]!.fromName} → ${docs[1]!.toName}`)
    .closest('[role="row"]')!;
  expect(
    within(unknownRow as HTMLElement).getByText('Сумма неизвестна'),
  ).toBeVisible();
  expect(within(zeroRow as HTMLElement).getByText(/0,00/)).toBeVisible();
  fireEvent.click(screen.getByLabelText('Выбрать все направления по фильтрам'));
  rerender(
    <AcceptedTransfersView
      documents={docs.slice(0, 1)}
      filters={emptyAcceptedFilters}
      onFilters={() => undefined}
      onExport={() => undefined}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'CSV выбранных (1)' }),
  ).toBeEnabled();
});
