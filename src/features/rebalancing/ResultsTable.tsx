import { VirtualTable } from '../../components/VirtualTable';
import { Button, SearchInput } from '../../components/ui';
import { fmtQty } from '../demand/DemandPage';
import type { RebalanceResultScope } from '../../domain/workspace';
import type {
  AcceptedTransfer,
  BranchRegistry,
  RebalanceProposal,
  RebalanceTransfer,
  SkuQuantityPolicy,
} from '../../domain/rebalancing';
export function ResultsTable({
  proposal,
  accepted,
  selected,
  rejected,
  registry,
  policies,
  query,
  scope,
  onQuery,
  onClearScope,
  onSelection,
  onReject,
  onRevoke,
  onAccept,
  stale,
  busy,
  acceptingDisabled = false,
}: {
  proposal: RebalanceProposal | null;
  accepted: AcceptedTransfer[];
  selected: string[];
  rejected: string[];
  registry: BranchRegistry;
  policies: SkuQuantityPolicy[];
  query: string;
  scope: RebalanceResultScope;
  onQuery: (q: string) => void;
  onClearScope: () => void;
  onSelection: (ids: string[]) => void;
  onReject: (id: string) => void;
  onRevoke: (id: string) => void;
  onAccept: () => void;
  stale: boolean;
  busy: boolean;
  acceptingDisabled?: boolean;
}) {
  const units = new Map(policies.map((p) => [p.skuCode, p.unit]));
  const names = new Map(registry.map((b) => [b.id, b.name]));
  const name = (id: string) => names.get(id) ?? id;
  const acceptedSources = new Set(
    accepted
      .filter((a) => a.sourceRunId === proposal?.runId)
      .map((a) => a.sourceLineId),
  );
  const rejectedIds = new Set(rejected);
  const match = (t: RebalanceTransfer | AcceptedTransfer) =>
    (!scope.skuCode || t.skuCode === scope.skuCode) &&
    (!scope.branchId ||
      t.fromBranchId === scope.branchId ||
      t.toBranchId === scope.branchId) &&
    `${t.skuCode} ${name(t.fromBranchId)} ${name(t.toBranchId)}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru'));
  const proposed = (proposal?.transfers ?? []).filter(
    (t) => !acceptedSources.has(t.sourceLineId),
  );
  const proposalIds = new Set(proposed.map((t) => t.sourceLineId));
  const visible = proposed.filter(match),
    eligible = visible.filter((t) => !rejectedIds.has(t.sourceLineId));
  const selectedIds = selected.filter(
    (id) => proposalIds.has(id) && !rejectedIds.has(id),
  );
  const columns = <T extends RebalanceTransfer | AcceptedTransfer>() => [
    {
      key: 'sku',
      header: 'Код 1С',
      width: '145px',
      render: (t: T) => <strong>{t.skuCode}</strong>,
    },
    {
      key: 'from',
      header: 'Отправитель',
      width: 'minmax(180px, 1fr)',
      render: (t: T) => name(t.fromBranchId),
    },
    {
      key: 'to',
      header: 'Получатель',
      width: 'minmax(180px, 1fr)',
      render: (t: T) => name(t.toBranchId),
    },
    {
      key: 'qty',
      header: 'Количество',
      width: '140px',
      className: 'num',
      render: (t: T) => `${fmtQty(t.qty)} ${units.get(t.skuCode) ?? ''}`,
    },
  ];
  return (
    <>
      {(scope.skuCode || scope.branchId) && (
        <div
          className="filters compact-filters"
          role="group"
          aria-label="Фильтры перемещений"
        >
          {scope.skuCode && <span>Товар: {scope.skuCode}</span>}
          {scope.branchId && <span>Подразделение: {name(scope.branchId)}</span>}
          <Button className="secondary" disabled={busy} onClick={onClearScope}>
            Сбросить фильтры
          </Button>
        </div>
      )}
      <div className="filters">
        <label className="filter-search">
          Поиск по коду и маршруту
          <SearchInput value={query} onValueChange={onQuery} />
        </label>
        <span>Отмечено: {selectedIds.length}</span>
        <Button
          disabled={!selectedIds.length || stale || busy || acceptingDisabled}
          onClick={onAccept}
        >
          Принять выбранные ({selectedIds.length})
        </Button>
      </div>
      <section className="rebalance-results">
        <div className="section-heading">
          <h2>Предложения · {proposed.length}</h2>
          <label className="checkbox-control">
            <input
              type="checkbox"
              aria-label="Выбрать видимые предложения"
              disabled={!eligible.length || stale || busy}
              checked={
                eligible.length > 0 &&
                eligible.every((t) => selectedIds.includes(t.sourceLineId))
              }
              onChange={(e) =>
                onSelection(
                  e.target.checked
                    ? [
                        ...new Set([
                          ...selectedIds,
                          ...eligible.map((t) => t.sourceLineId),
                        ]),
                      ]
                    : selectedIds.filter(
                        (id) => !eligible.some((t) => t.sourceLineId === id),
                      ),
                )
              }
            />
            Отметить видимые ({eligible.length})
          </label>
        </div>
        <p>
          Предложения и галочки не изменяют заказ. Отклонённые строки можно
          вернуть до нового расчёта.
        </p>
        <VirtualTable
          rows={visible}
          getRowKey={(t) => t.sourceLineId}
          emptyMessage={
            proposal
              ? 'Нет предложений по выбранным условиям и фильтру.'
              : 'Настройте условия и рассчитайте перемещения.'
          }
          columns={[
            {
              key: 'check',
              header: 'Выбор',
              width: '75px',
              render: (t) => (
                <input
                  type="checkbox"
                  aria-label={`Выбрать перемещение ${t.skuCode} ${name(
                    t.fromBranchId,
                  )} → ${name(t.toBranchId)}`}
                  checked={selectedIds.includes(t.sourceLineId)}
                  disabled={rejected.includes(t.sourceLineId) || stale || busy}
                  onChange={(e) =>
                    onSelection(
                      e.target.checked
                        ? [...selectedIds, t.sourceLineId]
                        : selectedIds.filter((id) => id !== t.sourceLineId),
                    )
                  }
                />
              ),
            },
            ...columns<RebalanceTransfer>(),
            {
              key: 'status',
              header: 'Решение',
              width: '150px',
              render: (t) => (
                <span>
                  {rejected.includes(t.sourceLineId)
                    ? 'Отклонено'
                    : 'Предложено'}
                </span>
              ),
            },
            {
              key: 'reject',
              header: 'Действие',
              width: '140px',
              render: (t) => (
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => onReject(t.sourceLineId)}
                >
                  {rejected.includes(t.sourceLineId) ? 'Вернуть' : 'Отклонить'}
                </button>
              ),
            },
          ]}
        />
      </section>
      <section className="rebalance-results">
        <h2>Учтённые перемещения · {accepted.length}</h2>
        <p>
          Только эти строки уменьшают текущую потребность. Отмена возвращает
          потребность к исходным нормативам.
        </p>
        <VirtualTable
          rows={accepted.filter(match)}
          getRowKey={(t) => t.transferId}
          emptyMessage={
            accepted.length
              ? 'Нет принятых перемещений по выбранным фильтрам.'
              : 'Принятых перемещений пока нет.'
          }
          columns={[
            ...columns<AcceptedTransfer>(),
            {
              key: 'status',
              header: 'Решение',
              width: '150px',
              render: () => <span className="success">Принято</span>,
            },
            {
              key: 'revoke',
              header: 'Действие',
              width: '180px',
              render: (t) => (
                <button
                  className="link"
                  disabled={busy || acceptingDisabled}
                  aria-label={`Отменить принятие ${t.skuCode} ${name(
                    t.fromBranchId,
                  )} → ${name(t.toBranchId)}`}
                  onClick={() => onRevoke(t.transferId)}
                >
                  Отменить принятие
                </button>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
