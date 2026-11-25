import { useCallback, useEffect, useRef, useState } from 'react';
import { DemandPage } from '../features/demand/DemandPage';
import { WorkspaceHistoryPage } from '../features/workspaces/WorkspaceHistoryPage';
import { RebalancingPage } from '../features/rebalancing/RebalancingPage';
import { ImportPage } from '../features/import/ImportPage';
import { InvoicesPage } from '../features/invoices/InvoicesPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SuppliersPage } from '../features/suppliers/SuppliersPage';
import { StoreContext, type AppState, type StatePatch, type WorkspaceRebaseCheck } from './appStore';
import { createInitialState } from './initialState';
import { createWorkspaceSession, stateFromWorkspace } from './workspaceSession';
import { loadActiveWorkspace, loadWorkspaceFile, saveWorkspace, saveWorkspaceView } from '../persistence/workspaces';
import { loadOrCreateSupplierCatalog, recoverSupplierCatalog } from '../persistence/supplierCatalog';
import { attachSupplierCatalog } from './catalogSession';
import { usePageScroll } from './usePageScroll';
import { AppToast } from '../components/AppToast';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';
import { ordersDocument, type OrdersDocument } from '../appbox/ordersDocument';
import { connectHostAutosave } from '../appbox/autosaveLifecycle';
import { save } from '../export/download';
import { WorkspaceConflictError, type WorkspaceFile } from '../domain/workspace';
import { WorkspaceMasthead, WorkspaceSidebar } from './WorkspaceChrome';

type RemoteSession = Awaited<ReturnType<OrdersDocument['loadSession']>>;

function stateFromRemote({ document, workspace, catalog, catalogRevision }: RemoteSession) {
  const initial = workspace
    ? stateFromWorkspace(workspace)
    : createInitialState({ workspaceId: document.id });
  if (catalogRevision !== null && !initial.minMax) initial.page = 'suppliers';
  return attachSupplierCatalog(initial, catalog);
}

export function App() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [initializing, setInitializing] = useState(true);
  const [pending, setPending] = useState(0);
  const pendingWrites = useRef(0);
  const [retry, setRetry] = useState(0);
  const shared = ordersDocument();
  const [checkingSave, setCheckingSave] = useState(false);
  const [checkNeeded, setCheckNeeded] = useState(false);
  useEffect(() => {
    if (!shared) return;
    const disconnect = connectHostAutosave(shared.saves);
    const unsubscribe = shared.saves.subscribe(() => setCheckNeeded(shared.saves.needsCheck()));
    return () => { unsubscribe(); disconnect?.(); };
  }, [shared]);
  const [sharedSession, setSharedSession] = useState<RemoteSession>();
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [invoiceContext, setInvoiceContext] = useState<{
    workspaceId: string; sourceId?: string | undefined; orderIds?: string[] | undefined; sequence: number;
  } | null>(null);
  const [invoiceExit, setInvoiceExit] = useState<{
    run: () => void; replacesSource: boolean;
  } | null>(null);
  const invoiceDirty = useRef(false);
  const markInvoiceDirty = useCallback((dirty: boolean) => {
    invoiceDirty.current = dirty;
    shared?.saves.setDraft('invoice', dirty ? () => {
      invoiceDirty.current = false;
      setInvoiceContext((current) => current && { ...current, sequence: current.sequence + 1 });
    } : undefined);
  }, [shared]);
  const session = useRef<ReturnType<typeof createWorkspaceSession> | null>(
    null,
  );
  const owner = session.current;
  useEffect(() => {
    shared?.saves.setReady(!initializing && Boolean(owner));
  }, [shared, initializing, owner]);

  const runSaving = async <T,>(task: () => Promise<T>, reportToHost = true): Promise<T> => {
    pendingWrites.current++;
    setPending((n) => n + 1);
    try {
      return await (shared && reportToHost ? shared.saves.run(task) : task());
    } finally {
      pendingWrites.current--;
      setPending((n) => n - 1);
    }
  };
  const commit = async (patch: StatePatch, rebase?: WorkspaceRebaseCheck) => {
    if (owner !== session.current) return;
    if (!owner) throw new Error('Локальное хранилище ещё не готово');
    const pageOnly = typeof patch !== 'function' && Object.keys(patch).every((key) => key === 'page');
    try {
      await runSaving(() => owner.commit((current) =>
        owner !== session.current
          ? {}
          : typeof patch === 'function'
            ? patch(current)
            : patch,
        rebase,
      ), !pageOnly);
    } catch (error) {
      const remoteConflict = shared && error instanceof WorkspaceConflictError;
      if (remoteConflict && owner === session.current) setRemoteChanged(true);
      if (owner === session.current && !(remoteConflict && rebase))
        owner.transient({
          storageError:
            error instanceof Error
              ? error.message
              : 'Не удалось сохранить сеанс',
          toast: 'Изменения не сохранены. Предыдущая версия сеанса сохранена.',
        });
      throw error;
    }
  };
  const restore = async (
    workspace: Parameters<
      NonNullable<import('./appStore').Store['restore']>
    >[0],
  ) => {
    if (owner !== session.current) return;
    if (!owner) throw new Error('Локальное хранилище ещё не готово');
    setPending((n) => n + 1);
    try {
      await owner.restore(workspace);
    } catch (error) {
      if (owner === session.current)
        owner.transient({
          storageError:
            error instanceof Error
              ? error.message
              : 'Ошибка восстановления сеанса',
        });
      throw error;
    } finally {
      setPending((n) => n - 1);
    }
  };
  const set = (patch: StatePatch) => {
    if (owner !== session.current) return;
    if (
      typeof patch !== 'function' &&
      Object.keys(patch).every((key) =>
        ['toast', 'minMaxLoading', 'supplierLoading', 'storageError'].includes(
          key,
        ),
      )
    ) {
      if (owner?.getState().importEpoch === state.importEpoch)
        owner.transient(patch);
      return;
    }
    void commit(patch).catch(() => undefined);
  };
  useEffect(() => {
    let cancelled = false;
    const importEpoch =
      (session.current?.getState().importEpoch ?? state.importEpoch) + 1;
    // Invalidate callbacks from the previous owner before reading storage.
    session.current = null;
    setInitializing(true);
    setRemoteChanged(false);
    setRefreshError('');
    void (async () => {
      try {
        const remote = shared ? await shared.loadSession() : undefined;
        const active = remote ? null : await loadActiveWorkspace();
        const initial = remote ? stateFromRemote(remote) : attachSupplierCatalog(
          active ? stateFromWorkspace(active) : createInitialState(),
          await loadOrCreateSupplierCatalog(active),
        );
        if (!cancelled) {
          initial.importEpoch = importEpoch;
          setSharedSession(remote);
          const nextSession: ReturnType<typeof createWorkspaceSession> =
            createWorkspaceSession({
              initial,
              save: saveWorkspace,
              saveView: saveWorkspaceView,
              ...(shared && { async loadLatest() {
                await shared.checkCatalog();
                const prepared = await shared.prepareSession();
                await shared.checkCatalog();
                return stateFromRemote(prepared.session);
              } }),
              recoverCatalog: recoverSupplierCatalog,
              publish: (next) => {
                if (session.current === nextSession) setState(next);
              },
            });
          session.current = nextSession;
          setState(initial);
        }
      } catch (error) {
        if (!cancelled)
          setState((current) => ({
            ...current,
            storageError:
              error instanceof Error
                ? error.message
                : 'Не удалось восстановить сеанс',
          }));
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
      session.current = null;
    };
  }, [retry, shared]);

  useEffect(() => {
    if (!shared || !sharedSession || initializing) return;
    const owner = session.current;
    if (!owner) return;
    let current = true;
    let checking = false;
    let sourceCheckAt = 0;
    const busy = () => !current || owner !== session.current || pendingWrites.current !== 0;
    const check = async () => {
      if (checking || busy()) return;
      checking = true;
      try {
        const checkSource = Date.now() - sourceCheckAt >= 8000;
        if (checkSource) sourceCheckAt = Date.now();
        const changed = await shared.hasUpdate(checkSource);
        if (busy()) return;
        if (changed) {
          let deferred = true;
          if (invoiceDirty.current) {
            setRemoteChanged(true);
            return;
          }
          await owner.synchronize(async () => {
            if (busy() || invoiceDirty.current) return null;
            const prepared = await shared.prepareSession();
            if (busy() || invoiceDirty.current) return null;
            const next = stateFromRemote(prepared.session);
            const saved = owner.getState();
            if (next.workspaceId !== saved.workspaceId ||
                (next.snapshotId !== saved.snapshotId && saved.workspaceRevision >= 0) ||
                next.workspaceRevision < saved.workspaceRevision) return null;
            // The empty document has no business snapshot until the first successful save.
            if (next.workspaceRevision < 0) next.snapshotId = saved.snapshotId;
            prepared.activate();
            setSharedSession(prepared.session);
            deferred = false;
            return next;
          });
          if (current) setRemoteChanged(deferred);
        } else {
          setRemoteChanged(false);
        }
        if (current) setRefreshError('');
      } catch {
        if (current) setRefreshError('Не удалось проверить актуальность сеанса AppBox.');
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), 2500);
    window.addEventListener('focus', check);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [shared, Boolean(sharedSession), initializing]);

  useEffect(() => {
    if (!state.toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => set({ toast: null }), 3500);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  usePageScroll(
    state.page,
    state.workspaceId,
    !initializing && Boolean(session.current),
  );

  useEffect(() => {
    if (state.page === 'invoices' && invoiceContext?.workspaceId !== state.workspaceId)
      setInvoiceContext({ workspaceId: state.workspaceId, sequence: 0 });
  }, [state.page, state.workspaceId, invoiceContext?.workspaceId]);

  if (initializing) {
    return <div className="boot">Загрузка сохранённых настроек…</div>;
  }

  if (!session.current)
    return (
      <main>
        <h1>Не удалось открыть сохранённый сеанс</h1>
        <p role="alert">{state.storageError}</p>
        <button onClick={() => setRetry((n) => n + 1)}>
          Повторить загрузку
        </button>
      </main>
    );
  const leaveInvoice = (navigate: () => void) => {
    if (state.page === 'invoices' && invoiceDirty.current) {
      setInvoiceExit({ run: navigate, replacesSource: false });
    } else {
      navigate();
    }
  };
  const navigation = {
    page: state.page,
    branches: state.minMax && (state.catalog || state.supplierAssignments) ? state.minMax.branches : undefined,
    supplierAccess: Boolean(sharedSession && !sharedSession.document.workspace &&
      (!sharedSession.catalogReadOnly || sharedSession.catalogRevision !== null)),
    onNavigate: (page: AppState['page']) => {
      if (page === 'invoices' && invoiceContext?.workspaceId !== state.workspaceId)
        setInvoiceContext({ workspaceId: state.workspaceId, sequence: 0 });
      set({ page });
    },
    onImport: () => {
      if (state.page !== 'import') {
        leaveInvoice(() => owner?.transient({ page: 'import' }));
      }
    },
  };
  const activeInvoice = invoiceContext?.workspaceId === state.workspaceId ? invoiceContext : null;
  const openInvoiceSource = (sourceId?: string, orderIds?: string[]) => {
    const open = () => {
      setInvoiceContext((previous) => ({
        workspaceId: state.workspaceId, sourceId, orderIds, sequence: (previous?.sequence ?? 0) + 1,
      }));
      set({ page: 'invoices' });
    };
    if (invoiceDirty.current) setInvoiceExit({ run: open, replacesSource: true });
    else open();
  };
  const refreshSession = () => {
    const reload = () => setRetry((n) => n + 1);
    if (invoiceDirty.current) {
      setInvoiceExit({ run: reload, replacesSource: true });
    } else reload();
  };
  const sharedStore = shared && sharedSession ? {
    team: sharedSession.document.workspace?.name ?? null,
    editable: sharedSession.document.role !== 'view',
    catalogReadOnly: sharedSession.catalogReadOnly,
    catalogRevision: sharedSession.catalogRevision,
    sourceConnected: sharedSession.sourceConnected,
    sourceUnavailable: sharedSession.sourceUnavailable,
    setDraft: shared.saves.setDraft,
    async changeCatalog(
      change: Parameters<OrdersDocument['changeCatalog']>[0],
      toast: string,
      base = { catalog: state.catalog, catalogRevision: sharedSession.catalogRevision },
    ) {
      if (!owner || owner !== session.current) throw new Error('Справочник закрыт.');
      await runSaving(async () => {
        await owner.synchronize(async () => {
          if (owner !== session.current) throw new Error('Справочник закрыт.');
          const saved = await shared.changeCatalog(change, base);
          if (owner !== session.current) return null;
          setSharedSession({ ...sharedSession, ...saved });
          return attachSupplierCatalog(owner.getState(), saved.catalog);
        });
        if (owner === session.current) owner.transient({
          toast,
          ...(change.kind === 'create' || change.kind === 'restore' ? { page: 'suppliers' } : {}),
        });
      });
    },
    ...(sharedSession.document.workspace && { async openReport(patch: Partial<AppState>, file: WorkspaceFile) {
      const initial = attachSupplierCatalog(createInitialState({
        settings: state.settings,
        rebalance: {
          ...state.rebalance,
          proposal: null,
          accepted: [],
          acceptedRevision: 0,
          selectedLineIds: [],
          rejectedLineIds: [],
        },
      }), state.catalog);
      const intake = createWorkspaceSession({
        initial,
        async save(value, _expected, files) {
          const result = await shared.openReport(value, files ?? [], file.bytes);
          if (result.document.id === sharedSession.document.id)
            owner?.transient({ toast: 'Этот отчёт уже открыт в текущем сеансе.' });
        },
        publish() {},
      });
      await runSaving(() => intake.commit(patch));
    } }),
  } : undefined;
  const viewingCatalog = state.page === 'suppliers' && sharedStore?.catalogRevision != null;
  const statusTone = checkNeeded ? 'error' : pending
    ? 'busy'
    : state.storageError
      ? 'error'
      : state.workspaceRevision < 0 && !viewingCatalog
        ? 'idle'
        : 'saved';
  const status = {
    busy: viewingCatalog ? 'Сохранение справочника…' : 'Сохранение сеанса…',
    error: checkNeeded ? 'Сохранение требует проверки' : 'Изменения не сохранены',
    idle: 'Начните с загрузки отчётов',
    saved: sharedStore ? !sharedStore.editable ? 'AppBox · Только просмотр'
      : viewingCatalog ? 'Справочник сохранён в AppBox' : 'Сеанс сохранён в AppBox'
      : 'Сеанс сохранён на этом компьютере',
  }[statusTone];

  return (
    <StoreContext.Provider
      value={{ state, set, commit, saving: pending > 0, ...(sharedStore ? { shared: sharedStore } : { restore }) }}
    >
      <div className="shell">
        <WorkspaceSidebar {...navigation} />
        <div className="content">
          <WorkspaceMasthead
            {...navigation}
            fileName={state.minMaxFileName}
            status={status}
            statusTone={statusTone}
          />
          {shared && checkNeeded && (
            <div className="alert" role="status">
              AppBox не подтвердил сохранение. Проверьте запись.{' '}
              <button className="link" disabled={checkingSave} onClick={() => {
                setCheckingSave(true);
                void shared.saves.check().finally(() => setCheckingSave(false));
              }}>
                {checkingSave ? 'Проверяем…' : 'Проверить сохранение'}
              </button>
            </div>
          )}
          {sharedStore && (remoteChanged || refreshError || sharedStore.sourceUnavailable) && (
            <div className="alert" role="status">
              {sharedStore.sourceUnavailable ? 'Общий справочник недоступен. Проверьте источник в AppBox.' :
                remoteChanged ? 'В AppBox есть обновления сеанса или справочника.' : refreshError}{' '}
              <button className="link" disabled={pending > 0} onClick={refreshSession}>
                Обновить данные
              </button>
            </div>
          )}
          {state.storageError && (
            <div className="alert danger" role="alert">
              Изменения не применены: {state.storageError}{' '}
              {!sharedStore && 'При конфликте другой вкладки откройте сохранённый сеанс заново.'}{' '}
              <button
                className="link"
                disabled={pending > 0}
                onClick={refreshSession}
              >
                Открыть сохранённый сеанс
              </button>
            </div>
          )}
          {state.page === 'history' ? (
            sharedStore ? (
              <main>
                <h1>Рабочие сеансы AppBox</h1>
                <p>Откройте нужный документ в «Моих документах» AppBox. Отчёты можно держать открытыми в разных вкладках.</p>
                {state.rawImports.minMax && <Button onClick={() => {
                  const report = state.rawImports.minMax;
                  if (!report) return;
                  void loadWorkspaceFile(report.fileId).then((file) => {
                    if (!file) throw new Error('Отчёт не найден');
                    save(new Blob([file.bytes], { type: file.type }), file.name);
                  }).catch(() => owner?.transient({ toast: 'Не удалось скачать исходный отчёт.' }));
                }}>Скачать исходный MIN/MAX</Button>}
              </main>
            ) : <WorkspaceHistoryPage onReconcile={openInvoiceSource} />
          ) : state.page === 'import' ? (
            <ImportPage />
          ) : state.page === 'all' ? (
            <DemandPage />
          ) : state.page.startsWith('branch:') ? (
            <DemandPage branch={state.page.slice(7)} />
          ) : state.page === 'rebalancing' ? (
            <RebalancingPage />
          ) : state.page === 'suppliers' ? (
            <SuppliersPage />
          ) : state.page === 'invoices' ? null : (
            <OrdersPage onReconcile={(orderIds) => openInvoiceSource(undefined, orderIds)} />
          )}
          {(activeInvoice || state.page === 'invoices') && (
            <div hidden={state.page !== 'invoices'}>
              <InvoicesPage
                key={`${state.workspaceId}:${activeInvoice?.sequence ?? 0}`}
                initialOrderIds={activeInvoice?.orderIds ?? []}
                initialSourceId={activeInvoice?.sourceId}
                onDirtyChange={markInvoiceDirty}
              />
            </div>
          )}
        </div>

        {invoiceExit && (
          <Dialog
            title={invoiceExit.replacesSource ? 'Открыть другой источник сверки?' : 'Выйти из сверки счёта?'}
            onClose={() => setInvoiceExit(null)}
            actions={
              <>
                <Button className="secondary" onClick={() => setInvoiceExit(null)}>Остаться</Button>
                <Button onClick={() => {
                  setInvoiceExit(null);
                  invoiceExit.run();
                }}>
                  {invoiceExit.replacesSource ? 'Открыть источник' : 'Выйти из сверки'}
                </Button>
              </>
            }
          >
            <p>{invoiceExit.replacesSource
              ? 'Новый источник заменит выбранные заказы, счета и ручные правки в черновике.'
              : 'Черновик сверки сохранится в открытом приложении до смены рабочего сеанса или источника сверки.'}</p>
          </Dialog>
        )}
        {state.toast && <AppToast message={state.toast} />}
      </div>
    </StoreContext.Provider>
  );
}
