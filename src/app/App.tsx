import { useEffect, useState } from 'react';
import { DemandPage } from '../features/demand/DemandPage';
import { ImportPage } from '../features/import/ImportPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SuppliersPage } from '../features/suppliers/SuppliersPage';
import { getSupplierOverrides } from '../persistence/supplierOverrides';
import { defaults, getSettings, saveSettings } from '../persistence/settings';
import { StoreContext, type AppState } from './appStore';

function createInitialState(
  overrides: AppState['overrides'] = [],
  settings: AppState['settings'] = defaults,
): AppState {
  return {
    minMax: null,
    suppliers: null,
    minMaxFileName: null,
    supplierFileName: null,
    minMaxIssues: [],
    supplierIssues: [],
    overrides,
    edits: [],
    settings,
    exportedOrderIds: [],
    page: 'import',
    toast: null,
    minMaxLoading: false,
    supplierLoading: false,
  };
}

export function App() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [initializing, setInitializing] = useState(true);

  const set = (patch: Partial<AppState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    Promise.all([getSupplierOverrides(), getSettings()])
      .then(([overrides, settings]) => {
        setState((current) => ({ ...current, overrides, settings }));
      })
      .catch(() => {
        set({
          toast:
            'Не удалось открыть локальное хранилище. Работа продолжится без сохранения настроек.',
        });
      })
      .finally(() => setInitializing(false));
  }, []);

  useEffect(() => {
    if (!initializing) {
      saveSettings(state.settings).catch(() => {
        set({ toast: 'Не удалось сохранить настройки порога на этом компьютере.' });
      });
    }
  }, [state.settings, initializing]);

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

  const imported = Boolean(state.minMax && state.suppliers);
  const resetImports = () => {
    if (
      state.edits.length > 0 &&
      !window.confirm(
        'Есть ручные изменения количества в заказах. Загрузить новые отчёты и сбросить эти изменения?',
      )
    ) {
      return;
    }
    setState(createInitialState(state.overrides, state.settings));
  };

  return (
    <StoreContext.Provider value={{ state, set }}>
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
                    className={state.page === `branch:${branch}` ? 'active' : ''}
                    onClick={() => set({ page: `branch:${branch}` })}
                  >
                    {branch}
                  </button>
                ))}
              </div>

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
              <button className="new-import" onClick={resetImports}>
                Загрузить новые отчёты
              </button>
            </nav>
          )}
        </aside>

        <div className="content">
          {state.page === 'import' ? (
            <ImportPage />
          ) : state.page === 'all' ? (
            <DemandPage />
          ) : state.page.startsWith('branch:') ? (
            <DemandPage branch={state.page.slice(7)} />
          ) : state.page === 'suppliers' ? (
            <SuppliersPage />
          ) : (
            <OrdersPage />
          )}
        </div>

        {state.toast && (
          <div className="toast" role="status">
            {state.toast}
          </div>
        )}
      </div>
    </StoreContext.Provider>
  );
}
