import { useCallback, useEffect, useRef, useState } from 'react';
import { DemandPage } from '../features/demand/DemandPage';
import { WorkspaceHistoryPage } from '../features/workspaces/WorkspaceHistoryPage';
import { RebalancingPage } from '../features/rebalancing/RebalancingPage';
import { ImportPage } from '../features/import/ImportPage';
import { InvoicesPage } from '../features/invoices/InvoicesPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SuppliersPage } from '../features/suppliers/SuppliersPage';
import { StoreContext, type AppState, type StatePatch } from './appStore';
import { createInitialState } from './initialState';
import { createWorkspaceSession, stateFromWorkspace } from './workspaceSession';
import { loadActiveWorkspace, saveWorkspace, saveWorkspaceView } from '../persistence/workspaces';
import { loadOrCreateSupplierCatalog, recoverSupplierCatalog } from '../persistence/supplierCatalog';
import { attachSupplierCatalog } from './catalogSession';
import { usePageScroll } from './usePageScroll';
import { AppToast } from '../components/AppToast';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';
import { WorkspaceMasthead, WorkspaceSidebar } from './WorkspaceChrome';

export function App() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [initializing, setInitializing] = useState(true);
  const [pending, setPending] = useState(0);
  const [retry, setRetry] = useState(0);
  const [invoiceOrderIds, setInvoiceOrderIds] = useState<string[]>([]);
  const [invoiceExit, setInvoiceExit] = useState<(() => void) | null>(null);
  const invoiceDirty = useRef(false);
  const markInvoiceDirty = useCallback((dirty: boolean) => {
    invoiceDirty.current = dirty;
  }, []);
  const session = useRef<ReturnType<typeof createWorkspaceSession> | null>(
    null,
  );
  const owner = session.current;
  const commit = async (patch: StatePatch) => {
    if (owner !== session.current) return;
    if (!owner) throw new Error('Локальное хранилище ещё не готово');
    setPending((n) => n + 1);
    try {
      await owner.commit((current) =>
        owner !== session.current
          ? {}
          : typeof patch === 'function'
            ? patch(current)
            : patch,
      );
    } catch (error) {
      if (owner === session.current)
        owner.transient({
          storageError:
            error instanceof Error
              ? error.message
              : 'Ошибка локального хранилища',
          toast: 'Изменения не сохранены. Предыдущая версия сеанса сохранена.',
        });
      throw error;
    } finally {
      setPending((n) => n - 1);
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
    void (async () => {
      try {
        const active = await loadActiveWorkspace();
        const catalog = await loadOrCreateSupplierCatalog(active);
        const initial = attachSupplierCatalog(active
          ? stateFromWorkspace(active)
          : createInitialState(), catalog);
        if (!cancelled) {
          initial.importEpoch = importEpoch;
          const nextSession: ReturnType<typeof createWorkspaceSession> =
            createWorkspaceSession({
              initial,
              save: saveWorkspace,
              saveView: saveWorkspaceView,
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
  }, [retry]);

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
      setInvoiceExit(() => navigate);
    } else {
      navigate();
    }
  };
  const navigation = {
    page: state.page,
    branches: state.minMax && (state.catalog || state.supplierAssignments) ? state.minMax.branches : undefined,
    onNavigate: (page: AppState['page']) => {
      if (page === 'invoices' && state.page === 'invoices') return;
      leaveInvoice(() => {
        if (page === 'invoices') setInvoiceOrderIds([]);
        set({ page });
      });
    },
    onImport: () => {
      if (state.page !== 'import') {
        leaveInvoice(() => owner?.transient({ page: 'import' }));
      }
    },
  };
  const statusTone = pending
    ? 'busy'
    : state.storageError
      ? 'error'
      : state.workspaceRevision < 0
        ? 'idle'
        : 'saved';
  const status = {
    busy: 'Сохранение сеанса…',
    error: 'Изменения не сохранены',
    idle: 'Начните с загрузки отчётов',
    saved: 'Сеанс сохранён на этом компьютере',
  }[statusTone];

  return (
    <StoreContext.Provider
      value={{ state, set, commit, restore, saving: pending > 0 }}
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
          {state.storageError && (
            <div className="alert danger" role="alert">
              Изменения не применены: {state.storageError}. Повторите действие.
              При конфликте другой вкладки откройте сохранённый сеанс заново.{' '}
              <button
                className="link"
                disabled={pending > 0}
                onClick={() => setRetry((n) => n + 1)}
              >
                Открыть сохранённый сеанс
              </button>
            </div>
          )}
          {state.page === 'history' ? (
            <WorkspaceHistoryPage />
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
          ) : state.page === 'invoices' ? (
            <InvoicesPage
              initialOrderIds={invoiceOrderIds}
              onDirtyChange={markInvoiceDirty}
            />
          ) : (
            <OrdersPage
              onReconcile={(orderIds) => {
                setInvoiceOrderIds(orderIds);
                set({ page: 'invoices' });
              }}
            />
          )}
        </div>

        {invoiceExit && (
          <Dialog
            title="Выйти из сверки счёта?"
            onClose={() => setInvoiceExit(null)}
            actions={
              <>
                <Button className="secondary" onClick={() => setInvoiceExit(null)}>Остаться</Button>
                <Button onClick={() => {
                  setInvoiceExit(null);
                  invoiceExit();
                }}>
                  Выйти из сверки
                </Button>
              </>
            }
          >
            <p>Ручные правки корректировки будут сброшены при переходе в другой раздел.</p>
          </Dialog>
        )}
        {state.toast && <AppToast message={state.toast} />}
      </div>
    </StoreContext.Provider>
  );
}
