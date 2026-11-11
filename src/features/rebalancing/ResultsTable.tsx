import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VirtualTable } from '../../components/VirtualTable';
import { Button, SearchInput } from '../../components/ui';
import { fmtQty, money } from '../demand/DemandPage';
import type { ReadTransferQuantity } from './TransferQuantityEditor';
import {
  buildTransferDirections,
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
  onRevokeMany,
  onAccept,
  onExport,
  onExportWorkbook,
  onEditQuantity,
  quantityDetails,
  stale,
  busy,
  acceptingDisabled = false,
  error = '',
  acceptanceCompleted = 0,
  ...input
}: TransferDocumentsInput & {
  onQuery: (query: string) => void;
  onClearScope: () => void;
  onSelection: (ids: string[]) => void;
  onReject: (id: string) => void;
  onRevoke: (id: string) => void;
  onRevokeMany?: (ids: string[]) => void;
  onAccept: (ids: string[]) => void;
  onExport: (documentId: string) => void;
  onExportWorkbook?: ((documentId: string) => void) | undefined;
  onEditQuantity?:
    | ((sourceLineId: string, qty: number) => Promise<void>)
    | undefined;
  quantityDetails?: ReadTransferQuantity | undefined;
  stale: boolean;
  busy: boolean;
  acceptingDisabled?: boolean;
  error?: string;
  acceptanceCompleted?: number;
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
  const lastAcceptance = useRef(acceptanceCompleted);
  useLayoutEffect(() => {
    if (lastAcceptance.current === acceptanceCompleted) return;
    lastAcceptance.current = acceptanceCompleted;
    setOpenedDocument(null);
  }, [acceptanceCompleted]);
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
  const routeSummaries = useMemo(
    () =>
      new Map(
        allDocs.map((doc) => [doc.id, summarizeTransferDocuments([doc])]),
      ),
    [allDocs],
  );
  const directionsBySku = useMemo(
    () => buildTransferDirections(allDocs),
    [allDocs],
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
  const rejectedCount = visibleLines.filter(
    (line) => line.decision === 'REJECTED',
  ).length;
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
  const hiddenSelectedCount = selectedIds.filter(
    (id) => !eligibleIds.has(id),
  ).length;
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
        {hiddenSelectedCount > 0 && (
          <small className="selection-scope" role="status">
            Скрыто фильтрами: {hiddenSelectedCount}
          </small>
        )}
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
        <p className="result-counts">
          Предложено строк по фильтрам: {eligible.length}. Учтено строк по
          фильтрам:{' '}
          {visibleLines.filter((l) => l.decision === 'ACCEPTED').length}.
          <span className={rejectedCount > 0 ? 'danger-text' : undefined}>
            Отклонено: {rejectedCount}
          </span>
          .
        </p>
        <details className="results-help">
          <summary>Как работают предложения и выбор</summary>
          <p>
            Строки матрицы — отправители, столбцы — получатели. Нажмите на
            ячейку, чтобы открыть состав. Предложения и галочки не изменяют
            заказы.
          </p>
        </details>
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
                  const fullRoute = routeSummaries.get(doc.id) ?? summary;
                  const routeClass = fullRoute.proposedCount
                    ? ''
                    : fullRoute.acceptedCount
                      ? ' is-reviewed'
                      : ' is-rejected';
                  return (
                    <button
                      className={
                        'order-cell' +
                        routeClass +
                        (summary.selectedCount > 0 ? ' has-selection' : '')
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
                      <span className="route-volume">
                        {doc.skuCount} SKU ·{' '}
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
                      <span className="route-decision-count">
                        Предложено: {fullRoute.proposedCount} · Принято:{' '}
                        {fullRoute.acceptedCount} из {fullRoute.activeCount}
                      </span>
                      <dl className="route-money">
                        <div>
                          <dt>Принято на сумму:</dt>
                          <dd>
                            {' '}
                            {summary.acceptedAmount === null
                              ? 'Сумма неизвестна'
                              : money(summary.acceptedAmount)}
                          </dd>
                        </div>
                        <div>
                          <dt>Выбрано на сумму:</dt>
                          <dd>
                            {' '}
                            {summary.selectedAmount === null
                              ? 'Сумма неизвестна'
                              : money(summary.selectedAmount)}
                          </dd>
                        </div>
                      </dl>
                      {fullRoute.rejectedCount > 0 && (
                        <span className="danger-text">
                          Отклонено: {fullRoute.rejectedCount}
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
          onRevokeMany={onRevokeMany}
          onAccept={onAccept}
          onExport={() => onExport(opened.id)}
          onExportWorkbook={
            onExportWorkbook ? () => onExportWorkbook(opened.id) : undefined
          }
          onEditQuantity={onEditQuantity}
          quantityDetails={quantityDetails}
          directionsBySku={directionsBySku}
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
