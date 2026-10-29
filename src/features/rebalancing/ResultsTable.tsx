import { useMemo, useState } from 'react';
import { VirtualTable } from '../../components/VirtualTable';
import { Button, SearchInput } from '../../components/ui';
import { fmtQty, money } from '../demand/DemandPage';
import {
  buildTransferDocuments,
  summarizeTransferDocuments,
  type TransferDocument,
  type TransferDocumentsInput,
} from './transferDocuments';
import { TransferDrawer } from './TransferDrawer';

export function ResultsTable({
  onQuery,
  onClearScope,
  onSelection,
  onReject,
  onRevoke,
  onAccept,
  onExport,
  stale,
  busy,
  acceptingDisabled = false,
  error = '',
  ...input
}: TransferDocumentsInput & {
  onQuery: (query: string) => void;
  onClearScope: () => void;
  onSelection: (ids: string[]) => void;
  onReject: (id: string) => void;
  onRevoke: (id: string) => void;
  onAccept: (ids: string[]) => void;
  onExport: (documentId: string) => void;
  stale: boolean;
  busy: boolean;
  acceptingDisabled?: boolean;
  error?: string;
}) {
  const {
    proposal,
    accepted,
    registry,
    policies,
    skus,
    snapshot,
    selected,
    rejected,
    query,
    scope,
  } = input;
  const docs = useMemo(
    () =>
      buildTransferDocuments({
        proposal,
        accepted,
        registry,
        policies,
        skus,
        snapshot,
        selected,
        rejected,
        query,
        scope,
      }),
    [
      proposal,
      accepted,
      registry,
      policies,
      skus,
      snapshot,
      selected,
      rejected,
      query,
      scope,
    ],
  );
  const [openedDocument, setOpenedDocument] = useState<TransferDocument | null>(
    null,
  );
  const allDocs = useMemo(
    () => buildTransferDocuments({ ...input, query: '', scope: {} }),
    [
      proposal,
      accepted,
      registry,
      policies,
      skus,
      snapshot,
      selected,
      rejected,
    ],
  );
  // Keep the parent modal mounted when revoking the last line removes its route.
  // The confirmation can then close before the operator closes the inspector.
  const opened =
    openedDocument &&
    (docs.find((doc) => doc.id === openedDocument.id) ?? {
      ...openedDocument,
      lines: [],
      skuCount: 0,
      totalAmount: 0,
      totalsByUnit: [],
    });
  const names = new Map(registry.map((b) => [b.id, b.name]));
  const rows = [...new Set(docs.map((doc) => doc.fromBranchId))];
  const recipients = [...new Set(docs.map((doc) => doc.toBranchId))];
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const visibleLines = docs.flatMap((doc) => doc.lines);
  const eligible = visibleLines.filter((l) => l.decision === 'PROPOSED');
  const selectedSet = new Set(selected),
    rejectedSet = new Set(rejected);
  const acceptedSources = new Set(
    accepted
      .filter((a) => a.sourceRunId === proposal?.runId)
      .map((a) => a.sourceLineId),
  );
  const selectedIds = (proposal?.transfers ?? [])
    .filter(
      (t) =>
        selectedSet.has(t.sourceLineId) &&
        !acceptedSources.has(t.sourceLineId) &&
        !rejectedSet.has(t.sourceLineId),
    )
    .map((t) => t.sourceLineId);
  const eligibleIds = new Set(eligible.map((l) => l.sourceLineId));
  return (
    <>
      {(scope.skuCode || scope.branchId) && (
        <div
          className="filters compact-filters"
          role="group"
          aria-label="Фильтры перемещений"
        >
          {scope.skuCode && <span>Товар: {scope.skuCode}</span>}
          {scope.branchId && (
            <span>
              Подразделение: {names.get(scope.branchId) ?? scope.branchId}
            </span>
          )}
          <Button className="secondary" disabled={busy} onClick={onClearScope}>
            Сбросить фильтры
          </Button>
        </div>
      )}
      <div className="filters">
        <label className="filter-search">
          Поиск по коду, артикулу, товару и маршруту
          <SearchInput
            aria-label="Поиск по коду, артикулу, товару и маршруту"
            value={query}
            onValueChange={onQuery}
          />
        </label>
        <span>Выбрано к принятию: {selectedIds.length}</span>
        <Button
          disabled={!selectedIds.length || stale || busy}
          onClick={() => onAccept(selectedIds)}
        >
          Принять выбранные ({selectedIds.length})
        </Button>
      </div>
      <section className="rebalance-results">
        <div className="section-heading">
          <h2>Перемещения по направлениям · {docs.length}</h2>
          <label className="checkbox-control">
            <input
              type="checkbox"
              aria-label="Выбрать видимые предложения"
              checked={eligible.length > 0 && eligible.every((l) => l.selected)}
              disabled={!eligible.length || stale || busy}
              onChange={(e) =>
                onSelection(
                  e.target.checked
                    ? [...new Set([...selectedIds, ...eligibleIds])]
                    : selectedIds.filter((id) => !eligibleIds.has(id)),
                )
              }
            />
            Отметить видимые ({eligible.length})
          </label>
        </div>
        <p>
          Предложено строк по фильтрам: {eligible.length}. Учтено строк по
          фильтрам:{' '}
          {visibleLines.filter((l) => l.decision === 'ACCEPTED').length}.
          Отклонено:{' '}
          {visibleLines.filter((l) => l.decision === 'REJECTED').length}.
        </p>
        <p>
          Строки матрицы — отправители, столбцы — получатели. Нажмите на ячейку,
          чтобы открыть состав. Предложения и галочки не изменяют заказы.
        </p>
        <div className="transfer-matrix">
          <VirtualTable
            rows={rows}
            getRowKey={(id) => id}
            emptyMessage={
              proposal
                ? 'Нет перемещений по выбранным условиям и фильтрам.'
                : 'Настройте условия и рассчитайте перемещения.'
            }
            columns={[
              {
                key: 'from',
                header: 'Отправитель ↓ · получатель →',
                width: '210px',
                className: 'transfer-identity',
                render: (id) => {
                  const summary = summarizeTransferDocuments(
                    allDocs.filter((doc) => doc.fromBranchId === id),
                  );
                  return (
                    <div
                      className="transfer-sender-summary"
                      role="group"
                      aria-label={`Итоги отправителя ${names.get(id) ?? id}`}
                    >
                      <strong>{names.get(id) ?? id}</strong>
                      <span>
                        Всего:{' '}
                        <b>
                          {summary.totalAmount === null
                            ? 'Сумма неизвестна'
                            : money(summary.totalAmount)}
                        </b>
                      </span>
                      <span>
                        Выбрано:{' '}
                        <b>
                          {summary.selectedAmount === null
                            ? 'Сумма неизвестна'
                            : money(summary.selectedAmount)}
                        </b>
                      </span>
                      <small>Все направления, без фильтров</small>
                    </div>
                  );
                },
              },
              ...recipients.map((to) => ({
                key: to,
                header: names.get(to) ?? to,
                width: 'minmax(190px, 1fr)',
                render: (from: string) => {
                  const doc = byId.get(JSON.stringify([from, to]));
                  if (!doc) return <span className="muted">—</span>;
                  const summary = summarizeTransferDocuments([doc]);
                  const acceptedCount = summary.acceptedCount;
                  return (
                    <button
                      className={
                        'order-cell ' +
                        (summary.activeCount > 0 &&
                        acceptedCount === summary.activeCount
                          ? 'is-reviewed'
                          : '')
                      }
                      aria-label={[
                        'Открыть перемещение',
                        doc.fromName,
                        '→',
                        doc.toName,
                      ].join(' ')}
                      onClick={() => setOpenedDocument(doc)}
                    >
                      <strong>
                        {doc.totalAmount === null
                          ? 'Сумма неизвестна'
                          : 'Сумма: ' + money(doc.totalAmount)}
                      </strong>
                      <span>{doc.skuCount} SKU</span>
                      <span>
                        {doc.totalsByUnit
                          .map(
                            (g) =>
                              fmtQty(g.qty) +
                              ' ' +
                              (g.unit ??
                                '(' + g.skuCode + ', единица не задана)'),
                          )
                          .join(' · ') || 'Нет активных позиций'}
                      </span>
                      <span>
                        Предложено:{' '}
                        {
                          doc.lines.filter((l) => l.decision === 'PROPOSED')
                            .length
                        }{' '}
                        · Принято: {acceptedCount} из {summary.activeCount}
                      </span>
                      <span>
                        Принято на сумму:{' '}
                        {summary.acceptedAmount === null
                          ? 'Сумма неизвестна'
                          : money(summary.acceptedAmount)}
                      </span>
                      <span>
                        Выбрано на сумму:{' '}
                        {summary.selectedAmount === null
                          ? 'Сумма неизвестна'
                          : money(summary.selectedAmount)}
                      </span>
                      {doc.lines.some((l) => l.decision === 'REJECTED') && (
                        <span>
                          Отклонено:{' '}
                          {
                            doc.lines.filter((l) => l.decision === 'REJECTED')
                              .length
                          }
                        </span>
                      )}
                      {doc.lines.some((l) => l.selected) && (
                        <span>Выбрано к принятию: {summary.selectedCount}</span>
                      )}
                    </button>
                  );
                },
              })),
            ]}
          />
        </div>
      </section>
      {opened && (
        <TransferDrawer
          document={opened}
          selected={selectedIds}
          onSelection={onSelection}
          onReject={onReject}
          onRevoke={onRevoke}
          onAccept={onAccept}
          onExport={() => onExport(opened.id)}
          exportCount={
            allDocs
              .find((doc) => doc.id === opened.id)
              ?.lines.filter((line) => line.decision === 'ACCEPTED').length ?? 0
          }
          onClose={() => setOpenedDocument(null)}
          stale={stale}
          busy={busy}
          saving={acceptingDisabled}
          error={error}
        />
      )}
    </>
  );
}
