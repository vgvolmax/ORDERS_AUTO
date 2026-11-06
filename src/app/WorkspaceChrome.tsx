import { BrandIcon } from '../components/BrandIcon';
import type { AppState } from './appStore';
import wordmark from '../styles/brand/wordmark.svg';
import inverseWordmark from '../styles/brand/wordmark-inverse.svg';

type Page = AppState['page'];

const sections = [
  { page: 'all', label: 'Все товары', toolbar: 'Потребность', icon: 'box' },
  {
    page: 'rebalancing',
    label: 'Перемещения',
    toolbar: 'Перемещения',
    icon: 'swap',
  },
  {
    page: 'suppliers',
    label: 'Поставщики',
    toolbar: 'Поставщики',
    icon: 'people',
  },
  { page: 'orders', label: 'Заказы', toolbar: 'Заказы', icon: 'cart' },
] as const;

type Navigation = {
  page: Page;
  branches: readonly string[] | undefined;
  onNavigate: (page: Page) => void;
  onImport: () => void;
};

export function WorkspaceSidebar({
  page,
  branches,
  onNavigate,
  onImport,
}: Navigation) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={inverseWordmark} alt="Волмакс Буст" width="190" height="69" />
      </div>
      <nav aria-label="Основная навигация">
        {branches && (
          <>
            {sections.map((section) => (
              <button
                key={section.page}
                type="button"
                aria-current={page === section.page ? 'page' : undefined}
                onClick={() => onNavigate(section.page)}
              >
                <BrandIcon name={section.icon} /> {section.label}
              </button>
            ))}
            <div className="nav-label">Подразделения</div>
            <div className="branch-nav">
              {branches.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  aria-current={
                    page === `branch:${branch}` ? 'page' : undefined
                  }
                  onClick={() => onNavigate(`branch:${branch}`)}
                >
                  {branch}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="workspace-side-tools">
          <button
            type="button"
            className={branches ? 'new-import' : undefined}
            aria-current={page === 'import' ? 'page' : undefined}
            onClick={onImport}
          >
            <BrandIcon name="upload" />{' '}
            {branches ? 'Загрузить новые отчёты' : 'Импорт отчётов'}
          </button>
          <button
            type="button"
            aria-current={page === 'history' ? 'page' : undefined}
            onClick={() => onNavigate('history')}
          >
            <BrandIcon name="clock" /> История сеансов
          </button>
          {page === 'history' && (
            <button
              type="button"
              onClick={() => onNavigate(branches ? 'all' : 'import')}
            >
              Вернуться к работе
            </button>
          )}
        </div>
      </nav>
    </aside>
  );
}

export function WorkspaceMasthead({
  page,
  branches,
  onNavigate,
  onImport,
  fileName,
  status,
  statusTone,
}: Navigation & {
  fileName: string | null;
  status: string;
  statusTone: 'idle' | 'busy' | 'error' | 'saved';
}) {
  return (
    <div className="workspace-masthead">
      <div className="workspace-masthead-row">
        <img src={wordmark} alt="" width="402" height="56" />
        {fileName && page !== 'import' && page !== 'history' && (
          <span className="workspace-source" title={fileName}>
            <BrandIcon name="file" />
            <span>{fileName}</span>
          </span>
        )}
        <div
          className="workspace-save-state"
          role="status"
          data-tone={statusTone}
        >
          {status}
        </div>
      </div>
      {page !== 'rebalancing' && (
        <nav className="workspace-shortcuts" aria-label="Рабочие разделы">
          <button
            type="button"
            aria-label="Раздел: Импорт"
            aria-current={page === 'import' ? 'page' : undefined}
            onClick={onImport}
          >
            <BrandIcon name="upload" /> Импорт
          </button>
          {sections.map((section) => (
            <button
              key={section.page}
              type="button"
              aria-label={`Раздел: ${section.toolbar}`}
              aria-current={
                page === section.page ||
                (section.page === 'all' && page.startsWith('branch:'))
                  ? 'page'
                  : undefined
              }
              disabled={!branches}
              onClick={() => onNavigate(section.page)}
            >
              <BrandIcon name={section.icon} /> {section.toolbar}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
