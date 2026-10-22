import { useMemo, useState } from 'react';
import { useDurableDraft } from '../../app/useDurableDraft';
import { useStore, type AppState } from '../../app/appStore';
import { useDerivedState } from '../../app/useDerivedState';
import { derive } from '../../app/selectors';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../app/rebalanceActions';
import { rebalanceConfigFingerprint } from '../../domain/rebalancing';
import { Alert, Button, MetricCard } from '../../components/ui';
import { ConditionsPanel } from './ConditionsPanel';
import { RoutesMatrix } from './RoutesMatrix';
import { ResultsTable } from './ResultsTable';
import { buildRebalancingWorkbook } from '../../export/rebalancingWorkbook';
import { save as download } from '../../export/download';
import { AcceptTransfersDialog } from './AcceptTransfersDialog';
const messages: Record<string, string> = {
  STALE_PROPOSAL:
    'Условия или снимок изменились. Рассчитайте предложения заново. Принятые перемещения сохранены.',
  REVISION_CONFLICT: 'Решения изменились. Откройте подтверждение заново.',
  INVALID_TRANSFER_BATCH:
    'Выбранные строки не проходят ограничения текущих условий. Проверьте порог суммы SKU и пересчитайте предложения.',
};
export const rebalanceMessage = (e: unknown) =>
  e instanceof Error
    ? messages[e.message] ?? e.message
    : 'Не удалось выполнить действие';
export function RebalancingPage() {
  const store = useStore(),
    { state, set, saving } = store,
    d = useDerivedState(state),
    r = state.rebalance;
  const proposedCount = useMemo(() => {
    const acceptedSources = new Set(
      r.accepted
        .filter((line) => line.sourceRunId === r.proposal?.runId)
        .map((line) => line.sourceLineId),
    );
    return (
      r.proposal?.transfers.filter(
        (line) => !acceptedSources.has(line.sourceLineId),
      ).length ?? 0
    );
  }, [r.accepted, r.proposal]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: 'accept' | 'revoke';
    ids: string[];
    expectedRevision: number;
    workspaceRevision: number;
    runId: string | undefined;
    snapshotId: string;
  } | null>(null);
  async function save(update: (s: AppState) => Partial<AppState>) {
    if (store.commit) await store.commit(update);
    else set(update);
  }
  const edit = (update: Partial<typeof r>) =>
    set((s) => ({ rebalance: { ...s.rebalance, ...update } }));
  const [configDraft, config] = useDurableDraft(
    r.config,
    state.workspaceId,
    (value) => save((s) => ({ rebalance: { ...s.rebalance, config: value } })),
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
  const [policies, changePolicies] = useDurableDraft(
    r.policies,
    state.workspaceId,
    (value) =>
      save((s) => {
        if (s.rebalance.accepted.length)
          throw new Error('Сначала отмените принятые перемещения');
        return {
          snapshotId: crypto.randomUUID(),
          rebalance: {
            ...s.rebalance,
            policies: value,
            proposal: null,
            selectedLineIds: [],
            rejectedLineIds: [],
          },
        };
      }),
  );
  const issues = [
    ...(d.snapshot?.issues ?? []),
    ...(r.proposal?.exclusions.filter((i) => !i.code.startsWith('ACCEPTED_')) ??
      []),
    ...d.acceptedSummary.diagnostics,
  ];
  const stale = Boolean(
    r.proposal &&
      (r.proposal.snapshotId !== state.snapshotId ||
        r.proposal.configFingerprint !==
          rebalanceConfigFingerprint(configDraft)),
  );
  function open(kind: 'accept' | 'revoke', ids: string[]) {
    setError('');
    try {
      prepareAcceptedChange(state, {
        kind,
        ids,
        expectedRevision: r.acceptedRevision,
      });
      setConfirmation({
        kind,
        ids,
        expectedRevision: r.acceptedRevision,
        workspaceRevision: state.workspaceRevision,
        runId: r.proposal?.runId,
        snapshotId: state.snapshotId,
      });
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
  async function confirm() {
    if (!confirmation || busy) return;
    setBusy(true);
    setError('');
    try {
      await save((s) => {
        if (
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
    } catch (e) {
      setError(rebalanceMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function calculate() {
    if (busy || saving) return;
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
  return (
    <main>
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
            onClick={calculate}
            disabled={busy || saving || !state.minMax || !state.suppliers}
          >
            {busy ? 'Сохранение…' : 'Рассчитать перемещения'}
          </Button>
        </div>
      </header>
      <div className="metrics metrics-three">
        <MetricCard label="Предложено строк" value={proposedCount} />
        <MetricCard label="Принято строк" value={r.accepted.length} />
        <MetricCard
          label="Отмечено строк"
          value={decisions.selectedLineIds.length}
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
            aria-selected={r.tab === tab}
            aria-controls="rebalance-panel"
            onKeyDown={(e) => {
              const tabs = ['routes', 'conditions', 'results'] as const;
              const i = tabs.indexOf(tab);
              const target =
                e.key === 'ArrowRight'
                  ? tabs[(i + 1) % 3]
                  : e.key === 'ArrowLeft'
                  ? tabs[(i + 2) % 3]
                  : e.key === 'Home'
                  ? tabs[0]
                  : e.key === 'End'
                  ? tabs[2]
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
        aria-labelledby={`rebalance-tab-${r.tab}`}
      >
        <fieldset className="workspace-controls" disabled={busy}>
          {r.tab === 'routes' && (
            <RoutesMatrix
              registry={r.registry}
              value={configDraft.routeConfig}
              onChange={(routeConfig) =>
                config({ ...configDraft, routeConfig })
              }
            />
          )}
          {r.tab === 'conditions' && (
            <ConditionsPanel
              config={configDraft}
              onChange={config}
              skus={state.minMax?.skus ?? []}
              policies={policies}
              locked={r.accepted.length > 0}
              onPolicies={changePolicies}
            />
          )}
          {r.tab === 'results' && (
            <>
              <ResultsTable
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
                onAccept={(ids) =>
                  open(
                    'accept',
                    ids.filter((id) => !r.rejectedLineIds.includes(id)),
                  )
                }
                stale={stale}
                busy={busy}
                acceptingDisabled={Boolean(saving)}
                error={confirmation ? '' : error}
              />
              {issues.length > 0 && (
                <details className="panel">
                  <summary>
                    Исключения и проверки данных · {issues.length}
                  </summary>
                  <ul>
                    {issues.slice(0, 100).map((i, n) => (
                      <li key={n}>
                        {i.skuCode ? `${i.skuCode}: ` : ''}
                        {i.message}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Показано до 100 сообщений. Полный список доступен в Excel
                    ребалансировки.
                  </p>
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
