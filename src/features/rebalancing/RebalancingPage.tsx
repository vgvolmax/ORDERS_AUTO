import { VirtualTable } from '../../components/VirtualTable';
import { productColumns } from '../../components/productColumns';
import { useMemo, useState } from 'react';
import { useDurableDraft } from '../../app/useDurableDraft';
import { useStore, type AppState } from '../../app/appStore';
import { useDerivedState } from '../../app/useDerivedState';
import { derive } from '../../app/selectors';
import { hasIncompatibleTransferQuantities } from '../../app/quantityPolicies';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../app/rebalanceActions';
import {
  ALGORITHM_VERSION,
  branchParticipationFingerprint,
  rebalanceConfigFingerprint,
} from '../../domain/rebalancing';
import { Alert, Button, MetricCard } from '../../components/ui';
import { ConditionsPanel } from './ConditionsPanel';
import { RoutesMatrix } from './RoutesMatrix';
import { ResultsTable } from './ResultsTable';
import { buildRebalancingWorkbook } from '../../export/rebalancingWorkbook';
import { save as download, downloadTransferCsv } from '../../export/download';
import { AcceptTransfersDialog } from './AcceptTransfersDialog';
import {
  buildTransferDocuments,
  summarizeTransferDocuments,
} from './transferDocuments';
import { fmtQty, money } from '../demand/DemandPage';
import { SkippedRebalanceList } from './SkippedRebalanceList';
import {
  buildFullCoverageSummary,
  type CoverageTotals,
} from './skippedRebalance';
function CoverageValue({ summary }: { summary: CoverageTotals }) {
  return (
    <>
      {summary.byUnit.length
        ? summary.byUnit.map((v) => (
            <span className="coverage-quantity" key={v.unit ?? v.skuCode}>
              {fmtQty(v.qty)} {v.unit ?? `(${v.skuCode}, единица не задана)`}
            </span>
          ))
        : '0'}
      <small>
        {summary.amount === null
          ? `Сумма неизвестна · без цены: ${summary.missingPriceSkuCount} SKU`
          : money(summary.amount)}
      </small>
    </>
  );
}
const messages: Record<string, string> = {
  STALE_PROPOSAL:
    'Условия или снимок изменились. Рассчитайте предложения заново. Принятые перемещения сохранены.',
  REVISION_CONFLICT: 'Решения изменились. Откройте подтверждение заново.',
  INVALID_TRANSFER_BATCH:
    'Количество не сохранено: проверьте целое количество, потребность получателя и общий выход. Остаток донора должен оставаться не ниже MAX. При принятии также действует порог суммы SKU.',
};
export const rebalanceMessage = (e: unknown) =>
  e instanceof Error
    ? (messages[e.message] ?? e.message)
    : 'Не удалось выполнить действие';
export function RebalancingPage() {
  const store = useStore(),
    { state, set, saving } = store,
    d = useDerivedState(state),
    r = state.rebalance;
  const policies = d.quantityPolicies;
  const skuByCode = useMemo(
    () => new Map((state.minMax?.skus ?? []).map((s) => [s.code, s])),
    [state.minMax?.skus],
  );
  const tab = r.tab === 'priorities' ? 'routes' : r.tab;
  const [showSkipped, setShowSkipped] = useState(false);
  const [acceptanceCompleted, setAcceptanceCompleted] = useState(0);
  const coverage = useMemo(
    () =>
      buildFullCoverageSummary({
        proposal: r.proposal,
        accepted: r.accepted,
        rejectedLineIds: r.rejectedLineIds,
        policies,
        skus: state.minMax?.skus ?? [],
      }),
    [r.proposal, r.accepted, r.rejectedLineIds, policies, state.minMax?.skus],
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: 'accept' | 'revoke';
    ids: string[];
    expectedRevision: number;
    workspaceRevision: number;
    workspaceId: string;
    runId: string | undefined;
    snapshotId: string;
  } | null>(null);
  async function save(update: (s: AppState) => Partial<AppState>) {
    const guarded = (s: AppState) => {
      if (s.workspaceId !== state.workspaceId)
        throw new Error('REVISION_CONFLICT');
      return update(s);
    };
    if (store.commit) await store.commit(guarded);
    else set(guarded);
  }
  const edit = (update: Partial<typeof r>) =>
    set((s) => ({ rebalance: { ...s.rebalance, ...update } }));
  const [configDraft, config] = useDurableDraft(
    r.config,
    state.workspaceId,
    (value) => save((s) => ({ rebalance: { ...s.rebalance, config: value } })),
  );
  const [registryDraft, changeRegistry] = useDurableDraft(
    r.registry,
    state.workspaceId,
    (registry) => save((s) => ({ rebalance: { ...s.rebalance, registry } })),
  );
  const persistedFilters = useMemo(
    () => ({ query: r.query, resultScope: r.resultScope ?? {} }),
    [r.query, r.resultScope],
  );
  const [filters, changeFilters] = useDurableDraft(
    persistedFilters,
    state.workspaceId,
    (value) => save((s) => ({ rebalance: { ...s.rebalance, ...value } })),
  );
  const persistedDecisions = useMemo(
    () => ({
      selectedLineIds: r.selectedLineIds,
      rejectedLineIds: r.rejectedLineIds,
    }),
    [r.selectedLineIds, r.rejectedLineIds],
  );
  const [decisions, changeDecisions] = useDurableDraft(
    persistedDecisions,
    state.workspaceId,
    (value) => save((s) => ({ rebalance: { ...s.rebalance, ...value } })),
  );
  const totals = useMemo(
    () =>
      summarizeTransferDocuments(
        buildTransferDocuments({
          proposal: r.proposal,
          accepted: r.accepted,
          rejected: decisions.rejectedLineIds,
          selected: [],
          registry: r.registry,
          skus: state.minMax?.skus ?? [],
          policies: [],
          snapshot: null,
          query: '',
          scope: {},
        }),
      ),
    [
      r.proposal,
      r.accepted,
      r.registry,
      decisions.rejectedLineIds,
      state.minMax?.skus,
    ],
  );
  const issues = [
    ...(d.snapshot?.issues ?? []),
    ...(r.proposal?.exclusions.filter((i) => !i.code.startsWith('ACCEPTED_')) ??
      []),
    ...d.acceptedSummary.diagnostics,
  ];
  const stale = Boolean(
    r.proposal &&
    (r.proposal.algorithmVersion !== ALGORITHM_VERSION ||
      hasIncompatibleTransferQuantities(
        r.proposal.transfers,
        d.snapshot?.issues ?? [],
      ) ||
      r.proposal.participationFingerprint !==
        branchParticipationFingerprint(registryDraft) ||
      r.proposal.snapshotId !== state.snapshotId ||
      r.proposal.configFingerprint !== rebalanceConfigFingerprint(configDraft)),
  );
  function open(kind: 'accept' | 'revoke', ids: string[]) {
    if (busy) return;
    setError('');
    const show = (current: AppState, requireSavedSelection = false) => {
      if (
        current.workspaceId !== state.workspaceId ||
        current.snapshotId !== state.snapshotId ||
        current.rebalance.proposal?.runId !== r.proposal?.runId
      )
        throw new Error('STALE_PROPOSAL');
      const chosen =
        kind === 'accept'
          ? ids.filter((id) => !current.rebalance.rejectedLineIds.includes(id))
          : ids;
      if (
        kind === 'accept' &&
        (!chosen.length ||
          (requireSavedSelection &&
            chosen.some(
              (id) => !current.rebalance.selectedLineIds.includes(id),
            )))
      )
        throw new Error(
          'Выбор не сохранён. Отметьте позиции повторно и попробуйте принять их ещё раз.',
        );
      prepareAcceptedChange(current, {
        kind,
        ids: chosen,
        expectedRevision: current.rebalance.acceptedRevision,
      });
      setConfirmation({
        kind,
        ids: chosen,
        expectedRevision: current.rebalance.acceptedRevision,
        workspaceRevision: current.workspaceRevision,
        workspaceId: current.workspaceId,
        runId: current.rebalance.proposal?.runId,
        snapshotId: current.snapshotId,
      });
    };
    if (saving) {
      setBusy(true);
      void (async () => {
        try {
          let current = state;
          await save((s) => {
            current = s;
            return {};
          });
          show(current, true);
        } catch (e) {
          setError(rebalanceMessage(e));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    try {
      show(state);
    } catch (e) {
      setError(rebalanceMessage(e));
    }
  }
  const preview = useMemo(() => {
    if (!confirmation) return null;
    try {
      return prepareAcceptedChange(state, confirmation);
    } catch {
      return null;
    }
  }, [state, confirmation]);
  const previewDemand = useMemo(
    () =>
      preview ? derive({ ...state, ...preview.patch }).purchaseDemand : [],
    [state, preview],
  );
  const confirmationSummary = useMemo(() => {
    if (!confirmation) return undefined;
    const ids = new Set(confirmation.ids);
    const chosen = buildTransferDocuments({
      proposal: r.proposal, accepted: r.accepted, registry: r.registry,
      policies, skus: state.minMax?.skus ?? [], snapshot: d.snapshot?.snapshot ?? null,
      selected: [], rejected: r.rejectedLineIds, query: '', scope: {},
    }).flatMap((doc) => doc.lines.filter((line) =>
      confirmation.kind === 'accept'
        ? line.decision === 'PROPOSED' && ids.has(line.sourceLineId)
        : line.decision === 'ACCEPTED' && ids.has(line.transferId ?? ''),
    ).map((line) => ({ ...line, donor: doc.fromName, recipient: doc.toName })));
    const missingPriceLineCount = chosen.filter((line) => line.amount === null).length;
    const amount = chosen.reduce((sum, line) => sum + (line.amount ?? 0), 0);
    return {
      donor: [...new Set(chosen.map((line) => line.donor))].join(', '),
      recipients: [...new Set(chosen.map((line) => line.recipient))],
      skuCount: new Set(chosen.map((line) => line.skuCode)).size,
      amount: missingPriceLineCount || !Number.isFinite(amount) ? null : amount,
      missingPriceLineCount,
    };
  }, [confirmation, r.proposal, r.accepted, r.registry, r.rejectedLineIds, policies, state.minMax?.skus, d.snapshot]);
  async function confirm() {
    if (!confirmation || busy) return;
    setBusy(true);
    setError('');
    try {
      await save((s) => {
        if (
          s.workspaceId !== confirmation.workspaceId ||
          s.workspaceRevision !== confirmation.workspaceRevision ||
          s.snapshotId !== confirmation.snapshotId ||
          s.rebalance.proposal?.runId !== confirmation.runId
        )
          throw new Error('REVISION_CONFLICT');
        return {
          ...prepareAcceptedChange(s, confirmation).patch,
          toast:
            confirmation.kind === 'accept'
              ? 'Перемещения приняты. Потребность и заказы пересчитаны.'
              : 'Принятие отменено. Потребность пересчитана.',
        };
      });
      setConfirmation(null);
      if (confirmation.kind === 'accept') setAcceptanceCompleted((n) => n + 1);
    } catch (e) {
      setError(rebalanceMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function calculate() {
    if (busy || saving) return;
    setShowSkipped(false);
    setBusy(true);
    setError('');
    try {
      await save((s) => ({
        rebalance: {
          ...s.rebalance,
          proposal: createProposal(s),
          selectedLineIds: [],
          rejectedLineIds: [],
          tab: 'results',
        },
      }));
    } catch (e) {
      setError(rebalanceMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function excel() {
    if (!d.snapshot || busy || saving) return;
    setBusy(true);
    setError('');
    try {
      const buffer = await buildRebalancingWorkbook({
        snapshot: d.snapshot.snapshot,
        config: r.config,
        proposal: r.proposal,
        accepted: r.accepted,
        purchaseDemand: d.purchaseDemand,
        issues: d.snapshot.issues,
        workspaceId: state.workspaceId,
        exportedAt: new Date().toISOString(),
        selectedLineIds: r.selectedLineIds,
        rejectedLineIds: r.rejectedLineIds,
      });
      download(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `Ребалансировка_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      setError(`Не удалось выгрузить Excel: ${rebalanceMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }
  function csv(documentId: string) {
    if (busy) return;
    setError('');
    try {
      const doc = buildTransferDocuments({
        proposal: r.proposal,
        accepted: r.accepted,
        registry: r.registry,
        policies,
        skus: state.minMax?.skus ?? [],
        snapshot: d.snapshot?.snapshot ?? null,
        selected: [],
        rejected: r.rejectedLineIds,
        query: '',
        scope: {},
      }).find((doc) => doc.id === documentId);
      if (!doc) throw new Error('В направлении нет принятых позиций.');
      downloadTransferCsv(doc);
      set({
        toast: `CSV перемещения ${doc.fromName} → ${doc.toName} сформирован.`,
      });
    } catch {
      setError('Не удалось скачать CSV перемещения. Повторите выгрузку.');
    }
  }
  return (
    <main
      className={
        tab === 'routes'
          ? 'rebalancing-page rebalancing-routes'
          : 'rebalancing-page'
      }
    >
      <header className="header-actions">
        <div>
          <p className="eyebrow">Внутренние перемещения</p>
          <h1>Ребалансировка</h1>
          <p>
            Примите конкретные перемещения, чтобы учесть их при формировании
            заказов.
          </p>
        </div>
        <div className="rebalance-header-actions">
          <Button
            className="secondary"
            disabled={busy || saving || !d.snapshot}
            onClick={excel}
          >
            Excel ребалансировки
          </Button>
          <Button
            onClick={() => void calculate()}
            disabled={busy || saving || !state.minMax || !state.suppliers}
          >
            {busy ? 'Сохранение…' : 'Рассчитать перемещения'}
          </Button>
        </div>
      </header>
      <div className="metrics coverage-metrics">
        <MetricCard
          label="К перемещению"
          value={
            r.proposal ? (
              <CoverageValue summary={coverage.pending} />
            ) : (
              'Нет расчёта'
            )
          }
          note="Непринятые предложения · цены MIN/MAX"
        />
        <MetricCard
          label="Не распределено"
          value={
            r.proposal?.algorithmVersion === ALGORITHM_VERSION ? (
              <CoverageValue summary={coverage.skipped} />
            ) : r.proposal ? (
              'Нужен пересчёт'
            ) : (
              'Нет расчёта'
            )
          }
          note={
            <>
              {coverage.skipped.skuCount} SKU · вся пропущенная потребность
              <br />
              <button
                className="link"
                disabled={busy}
                onClick={() => {
                  setShowSkipped(true);
                  edit({ tab: 'results' });
                }}
              >
                Показать список
              </button>
            </>
          }
        />
        <MetricCard
          label="Принято на сумму"
          value={
            totals.acceptedAmount === null
              ? 'Сумма неизвестна'
              : money(totals.acceptedAmount)
          }
          note={`${totals.acceptedCount} из ${totals.activeCount} активных строк · выбрано ${decisions.selectedLineIds.length}`}
        />
      </div>
      <div
        role="tablist"
        aria-label="Ребалансировка"
        className="workspace-tabs"
      >
        {(['routes', 'conditions', 'results'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            id={`rebalance-tab-${tab}`}
            aria-selected={(r.tab === 'priorities' ? 'routes' : r.tab) === tab}
            aria-controls="rebalance-panel"
            onKeyDown={(e) => {
              const tabs = ['routes', 'conditions', 'results'] as const;
              const i = tabs.indexOf(tab);
              const target =
                e.key === 'ArrowRight'
                  ? tabs[(i + 1) % tabs.length]
                  : e.key === 'ArrowLeft'
                    ? tabs[(i + tabs.length - 1) % tabs.length]
                    : e.key === 'Home'
                      ? tabs[0]
                      : e.key === 'End'
                        ? tabs[tabs.length - 1]
                        : null;
              if (target) {
                e.preventDefault();
                edit({ tab: target });
                document.getElementById(`rebalance-tab-${target}`)?.focus();
              }
            }}
            onClick={() => edit({ tab })}
          >
            {
              {
                routes: 'Маршруты',
                conditions: 'Условия',
                results: 'Результаты',
              }[tab]
            }
          </button>
        ))}
      </div>
      {error && !confirmation && <Alert tone="danger">{error}</Alert>}
      {stale && (
        <Alert tone="warning">
          Предложения устарели после изменения условий. Выполните новый расчёт.
          Принятые перемещения продолжают учитываться.
        </Alert>
      )}
      <div
        role="tabpanel"
        id="rebalance-panel"
        aria-labelledby={`rebalance-tab-${tab}`}
      >
        <fieldset className="workspace-controls" disabled={busy}>
          {tab === 'routes' && (
            <RoutesMatrix
              registry={registryDraft}
              onRegistryChange={changeRegistry}
              value={configDraft.routeConfig}
              onChange={(routeConfig) =>
                config({ ...configDraft, routeConfig })
              }
            />
          )}
          {tab === 'conditions' && (
            <ConditionsPanel config={configDraft} onChange={config} />
          )}
          {tab === 'results' && (
            <>
              {showSkipped ? (
                <SkippedRebalanceList
                  proposal={r.proposal}
                  registry={r.registry}
                  policies={policies}
                  skus={state.minMax?.skus ?? []}
                  stale={stale}
                  onBack={() => setShowSkipped(false)}
                />
              ) : (
                <>
                  <div className="rebalance-result-switch">
                    <Button
                      className="secondary"
                      onClick={() => setShowSkipped(true)}
                    >
                      Не распределено · {r.proposal?.skippedSkus?.length ?? '—'}{' '}
                      SKU
                    </Button>
                  </div>
                  <ResultsTable
                    acceptanceCompleted={acceptanceCompleted}
                    key={`${state.workspaceId}:${state.snapshotId}:${
                      r.proposal?.runId ?? ''
                    }`}
                    proposal={r.proposal}
                    accepted={r.accepted}
                    selected={decisions.selectedLineIds}
                    rejected={decisions.rejectedLineIds}
                    registry={r.registry}
                    policies={policies}
                    skus={state.minMax?.skus ?? []}
                    snapshot={d.snapshot?.snapshot ?? null}
                    query={filters.query}
                    scope={filters.resultScope}
                    onQuery={(query) =>
                      changeFilters({
                        query,
                        resultScope: filters.resultScope.branchId
                          ? { branchId: filters.resultScope.branchId }
                          : {},
                      })
                    }
                    onClearScope={() =>
                      changeFilters({ query: '', resultScope: {} })
                    }
                    onSelection={(selectedLineIds) =>
                      changeDecisions({ ...decisions, selectedLineIds })
                    }
                    onReject={(id) =>
                      changeDecisions({
                        rejectedLineIds: decisions.rejectedLineIds.includes(id)
                          ? decisions.rejectedLineIds.filter((v) => v !== id)
                          : [...decisions.rejectedLineIds, id],
                        selectedLineIds: decisions.selectedLineIds.filter(
                          (v) => v !== id,
                        ),
                      })
                    }
                    onRevoke={(id) => open('revoke', [id])}
                    onAccept={(ids) => open('accept', ids)}
                    onExport={csv}
                    stale={stale}
                    busy={busy}
                    acceptingDisabled={Boolean(saving)}
                    error={confirmation ? '' : error}
                  />
                </>
              )}
              {issues.length > 0 && (
                <details className="panel">
                  <summary>
                    Исключения и проверки данных · {issues.length}
                  </summary>
                  <VirtualTable
                    rows={issues.map((issue, rowId) => ({ ...issue, rowId }))}
                    getRowKey={(i) => String(i.rowId)}
                    columns={[
                      ...productColumns<
                        (typeof issues)[number] & { rowId: number }
                      >((i) => ({
                        code: i.skuCode ?? '—',
                        article:
                          skuByCode.get(i.skuCode ?? '')?.article ?? null,
                        name:
                          skuByCode.get(i.skuCode ?? '')?.name ??
                          'Общая проверка',
                      })),
                      {
                        key: 'reason',
                        header: 'Проверка',
                        width: 'minmax(300px,2fr)',
                        render: (i) => i.message,
                      },
                    ]}
                  />
                </details>
              )}
            </>
          )}
        </fieldset>
      </div>
      {confirmation && preview && (
        <AcceptTransfersDialog
          kind={confirmation.kind}
          count={confirmation.ids.length}
          scopeSummary={confirmationSummary}
          before={d.purchaseDemand}
          after={previewDemand}
          clearedEdits={preview.clearedEditCount}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onClose={() => setConfirmation(null)}
        />
      )}
      {confirmation && !preview && (
        <Alert tone="danger">
          Подтверждение устарело.{' '}
          <button className="link" onClick={() => setConfirmation(null)}>
            Закрыть подтверждение
          </button>
        </Alert>
      )}
    </main>
  );
}
