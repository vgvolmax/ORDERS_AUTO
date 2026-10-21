import { useEffect, useRef, useState } from 'react';
import { DemandPage } from '../features/demand/DemandPage';
import { WorkspaceHistoryPage } from '../features/workspaces/WorkspaceHistoryPage';
import { RebalancingPage } from '../features/rebalancing/RebalancingPage';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';
import { ImportPage } from '../features/import/ImportPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SuppliersPage } from '../features/suppliers/SuppliersPage';
import { getSupplierOverrides } from '../persistence/supplierOverrides';
import { getSettings } from '../persistence/settings';
import { StoreContext, type AppState, type StatePatch } from './appStore';
import { createInitialState } from './initialState';
import { createWorkspaceSession, stateFromWorkspace } from './workspaceSession';
import { loadActiveWorkspace, saveWorkspace } from '../persistence/workspaces';

export function App() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [initializing, setInitializing] = useState(true);
  const [pending, setPending] = useState(0);
  const [retry, setRetry] = useState(0);
  const [newImportOpen, setNewImportOpen] = useState(false);
  const session = useRef<ReturnType<typeof createWorkspaceSession> | null>(
    null,
  );
  const commit = async (patch: StatePatch) => {
    if (!session.current) throw new Error('Локальное хранилище ещё не готово');
    setPending((n) => n + 1);
    try {
      await session.current.commit(patch);
    } catch (error) {
      session.current.transient({
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
    if (!session.current) throw new Error('Локальное хранилище ещё не готово');
    setPending((n) => n + 1);
    try {
      await session.current.restore(workspace);
    } catch (error) {
      session.current.transient({
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
    if (
      typeof patch !== 'function' &&
      Object.keys(patch).every((key) =>
        ['toast', 'minMaxLoading', 'supplierLoading', 'storageError'].includes(
          key,
        ),
      )
    ) {
      session.current?.transient(patch);
      return;
    }
    void commit(patch).catch(() => undefined);
  };
  useEffect(() => {
    let cancelled = false;
    setInitializing(true);
    void (async () => {
      try {
        const active = await loadActiveWorkspace();
        const initial = active
          ? stateFromWorkspace(active)
          : createInitialState({
              overrides: await getSupplierOverrides(),
              settings: await getSettings(),
            });
        if (!cancelled) {
          session.current = createWorkspaceSession({
            initial,
            save: saveWorkspace,
            publish: setState,
          });
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
    };
  }, [retry]);

  useEffect(() => {
    if (!state.toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => set({ toast: null }), 3500);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

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
  const imported = Boolean(state.minMax && state.suppliers);
  const resetImports = () => {
    set((s) => ({
      importEpoch: s.importEpoch + 1,
      minMaxLoading: false,
      supplierLoading: false,
      minMax: null,
      suppliers: null,
      minMaxFileName: null,
      supplierFileName: null,
      minMaxIssues: [],
      supplierIssues: [],
      rawImports: { minMax: null, suppliers: null },
      page: 'import',
    }));
  };

  return (
    <StoreContext.Provider
      value={{ state, set, commit, restore, saving: pending > 0 }}
    >
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span aria-hidden="true">OA</span>
            <div>
              <strong>ORDERS_AUTO</strong>
              <small>Формирование заказов</small>
            </div>
          </div>

          {imported && (
            <nav aria-label="Основная навигация">
              <button
                className={state.page === 'all' ? 'active' : ''}
                onClick={() => set({ page: 'all' })}
              >
                Все товары
              </button>

              <div className="nav-label">Подразделения</div>
              <div className="branch-nav">
                {state.minMax!.branches.map((branch) => (
                  <button
                    key={branch}
                    className={
                      state.page === `branch:${branch}` ? 'active' : ''
                    }
                    onClick={() => set({ page: `branch:${branch}` })}
                  >
                    {branch}
                  </button>
                ))}
              </div>

              <button
                className={state.page === 'rebalancing' ? 'active' : ''}
                onClick={() => set({ page: 'rebalancing' })}
              >
                Ребалансировка
              </button>
              <button
                className={state.page === 'suppliers' ? 'active' : ''}
                onClick={() => set({ page: 'suppliers' })}
              >
                Поставщики
              </button>
              <button
                className={state.page === 'orders' ? 'active' : ''}
                onClick={() => set({ page: 'orders' })}
              >
                Заказы
              </button>
              <button
                className="new-import"
                onClick={() => setNewImportOpen(true)}
              >
                Загрузить новые отчёты
              </button>
            </nav>
          )}
          <button
            className={state.page === 'history' ? 'active' : ''}
            onClick={() => set({ page: 'history' })}
          >
            История сеансов
          </button>
          {state.page === 'history' && (
            <button onClick={() => set({ page: imported ? 'all' : 'import' })}>
              Вернуться к работе
            </button>
          )}
        </aside>

        <div className="content">
          <div className="workspace-save-state" role="status">
            {pending
              ? 'Сохранение сеанса…'
              : state.storageError
              ? 'Изменения не сохранены'
              : state.workspaceRevision < 0
              ? 'Начните с загрузки отчётов'
              : 'Сеанс сохранён на этом компьютере'}
          </div>
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
          ) : (
            <OrdersPage />
          )}
        </div>

        {newImportOpen && (
          <Dialog
            title="Загрузить новые отчёты?"
            onClose={() => setNewImportOpen(false)}
            actions={
              <>
                <Button
                  className="secondary"
                  onClick={() => setNewImportOpen(false)}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => {
                    resetImports();
                    setNewImportOpen(false);
                  }}
                >
                  Начать новый сеанс
                </Button>
              </>
            }
          >
            <p>
              Текущая работа останется в истории. В новом сеансе принятые
              перемещения, ручные количества и отметки заказов будут сброшены.
              Настройки маршрутов и условий сохранятся.
            </p>
          </Dialog>
        )}
        {state.toast && (
          <div className="toast" role="status">
            {state.toast}
          </div>
        )}
      </div>
    </StoreContext.Provider>
  );
}
