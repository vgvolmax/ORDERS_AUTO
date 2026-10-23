import { Dialog } from '../../components/Dialog';
import { DonorPriorities } from './DonorPriorities';
import { DonorAllocationDrawer } from './DonorAllocationDrawer';
import { buildDonorAllocationModel } from '../../domain/rebalancing/allocationPlan';
import {
  prepareDonorPlanChange,
  type DonorPlanCommand,
} from '../../app/rebalanceActions';
import { useMemo, useRef, useState } from 'react';
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
import { save as download, downloadTransferCsv } from '../../export/download';
import { AcceptTransfersDialog } from './AcceptTransfersDialog';
import {
  buildTransferDocuments,
  summarizeTransferDocuments,
} from './transferDocuments';
import { money } from '../demand/DemandPage';
const messages: Record<string, string> = {
  STALE_PROPOSAL:
    'Условия или снимок изменились. Рассчитайте предложения заново. Принятые перемещения сохранены.',
  REVISION_CONFLICT: 'Решения изменились. Откройте подтверждение заново.',
  INVALID_TRANSFER_BATCH:
    'Количество не сохранено: проверьте шаг, потребность получателя и общий выход. Остаток донора должен оставаться не ниже MAX. При принятии также действует порог суммы SKU.',
  PRIORITIES_REQUIRED:
    'Сначала задайте приоритеты для товаров с нехваткой излишка. Откройте карточку донора на вкладке «Приоритеты».',
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
  const [donorId, setDonorId] = useState<string | null>(null);
  const [planSaving, setPlanSaving] = useState(0);
  const editSequence = useRef(0);
  const [recalculateWarning, setRecalculateWarning] = useState(false);
  const allocationContext = useMemo(
    () =>
      r.proposal && d.snapshot && r.proposal.snapshotId === state.snapshotId
        ? {
            snapshot: d.snapshot.snapshot,
            proposal: r.proposal,
            accepted: r.accepted,
            rejectedLineIds: r.rejectedLineIds,
          }
        : null,
    [r.proposal, d.snapshot, r.accepted, r.rejectedLineIds, state.snapshotId],
  );
  const allocation = useMemo(() => {
    try {
      return {
        rows: allocationContext
          ? buildDonorAllocationModel(allocationContext)
          : [],
        error: '',
      };
    } catch (e) {
      return { rows: [], error: rebalanceMessage(e) };
    }
  }, [allocationContext]);
  const blockedSources = useMemo(
    () =>
      new Set(
        allocation.rows
          .filter((r) => r.priorityRequired)
          .flatMap((r) =>
            r.cells.filter((c) => c.qty > 0).map((c) => c.sourceLineId),
          ),
      ),
    [allocation.rows],
  );
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
  async function editPlan(command: DonorPlanCommand) {
    if (!r.proposal) return;
    const expected = {
      runId: r.proposal.runId,
      acceptedRevision: r.acceptedRevision,
    };
    const sequence = ++editSequence.current;
    setPlanSaving((n) => n + 1);
    setError('');
    try {
      await save((s) => prepareDonorPlanChange(s, command, expected));
      if (sequence === editSequence.current) setError('');
    } catch (e) {
      if (sequence === editSequence.current) setError(rebalanceMessage(e));
      throw e;
    } finally {
      setPlanSaving((n) => n - 1);
    }
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
    if (busy) return;
    setError('');
    const show = (current: AppState, requireSavedSelection = false) => {
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
        runId: current.rebalance.proposal?.runId,
        snapshotId: current.snapshotId,
      });
    };
    if (saving) {
      setBusy(true);
      void (async () => {
        try {
          let current = state;
          // Read barrier: no write/revision change, after all preceding queued saves.
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
  function csv(documentId: string) {
    if (busy) return;
    setError('');
    try {
      const doc = buildTransferDocuments({
        proposal: r.proposal,
        accepted: r.accepted,
        registry: r.registry,
        policies: r.policies,
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
            onClick={() => {
              if (r.proposal?.allocationRevision) setRecalculateWarning(true);
              else void calculate();
            }}
            disabled={busy || saving || !state.minMax || !state.suppliers}
          >
            {busy ? 'Сохранение…' : 'Рассчитать перемещения'}
          </Button>
        </div>
      </header>
      <div className="metrics transfer-metrics">
        <MetricCard
          label="Сумма перемещений"
          value={
            totals.totalAmount === null
              ? 'Сумма неизвестна'
              : money(totals.totalAmount)
          }
          note="Все активные строки, по ценам MIN/MAX"
        />
        <MetricCard
          label="Принято на сумму"
          value={
            totals.acceptedAmount === null
              ? 'Сумма неизвестна'
              : money(totals.acceptedAmount)
          }
          note={`${totals.acceptedCount} из ${totals.activeCount} активных строк`}
        />
        <MetricCard label="Предложено строк" value={totals.proposedCount} />
        <MetricCard label="Принято строк" value={r.accepted.length} />
        <MetricCard
          label="Выбрано к принятию"
          value={decisions.selectedLineIds.length}
        />
      </div>
      <div
        role="tablist"
        aria-label="Ребалансировка"
        className="workspace-tabs"
      >
        {(['routes', 'conditions', 'results', 'priorities'] as const).map(
          (tab) => (
            <button
              key={tab}
              role="tab"
              id={`rebalance-tab-${tab}`}
              aria-selected={r.tab === tab}
              aria-controls="rebalance-panel"
              onKeyDown={(e) => {
                const tabs = [
                  'routes',
                  'conditions',
                  'results',
                  'priorities',
                ] as const;
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
                  priorities: 'Приоритеты',
                }[tab]
              }
            </button>
          ),
        )}
      </div>
      {error && !confirmation && !donorId && (
        <Alert tone="danger">{error}</Alert>
      )}
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
          {r.tab === 'priorities' && (
            <>
              <DonorPriorities
                rows={allocation.rows}
                context={allocationContext}
                onOpen={setDonorId}
              />
              {allocation.error && (
                <Alert tone="danger">{allocation.error}</Alert>
              )}
            </>
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
                onAccept={(ids) => open('accept', ids)}
                onExport={csv}
                onPriorities={setDonorId}
                blockedSources={blockedSources}
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
      {donorId && (
        <DonorAllocationDrawer
          key={`${r.proposal?.runId}:${donorId}`}
          name={r.registry.find((b) => b.id === donorId)?.name ?? donorId}
          fromBranchId={donorId}
          recipients={r.registry.filter(
            (branch) => branch.active && branch.id !== donorId,
          )}
          rows={allocation.rows.filter((r) => r.fromBranchId === donorId)}
          mode={r.proposal?.allocationModes?.[donorId] ?? 'PROPORTIONAL'}
          onEdit={editPlan}
          onClose={() => setDonorId(null)}
          onResults={() => {
            setDonorId(null);
            edit({ tab: 'results' });
          }}
          stale={stale || !allocationContext}
          saving={Boolean(saving) || planSaving > 0}
          error={error || allocation.error}
        />
      )}
      {recalculateWarning && (
        <Dialog
          title="Пересчитать перемещения?"
          onClose={() => setRecalculateWarning(false)}
          actions={
            <>
              <Button
                className="secondary"
                onClick={() => setRecalculateWarning(false)}
              >
                Сохранить текущий план
              </Button>
              <Button
                disabled={busy || saving}
                onClick={() => {
                  setRecalculateWarning(false);
                  void calculate();
                }}
              >
                Пересчитать и сбросить правки
              </Button>
            </>
          }
        >
          <p>
            Новый расчёт заменит приоритеты и ручные количества текущего плана.
            Уже принятые перемещения сохранятся.
          </p>
        </Dialog>
      )}
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
