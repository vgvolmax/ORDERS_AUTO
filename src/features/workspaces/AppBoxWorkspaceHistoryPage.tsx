import { useEffect, useState } from 'react';
import type { DocSummary, WorkingSession } from '../../appbox/documentValue';
import type { OrdersDocument } from '../../appbox/ordersDocument';
import { Alert, Button, SearchInput } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';

type SessionList =
  | { kind: 'loading' | 'unavailable' | 'error' }
  | { kind: 'ready'; sessions: WorkingSession[] };

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export function AppBoxWorkspaceHistoryPage({ connection, document, saving, onDownloadReport }: {
  connection: OrdersDocument;
  document: DocSummary;
  saving: boolean;
  onDownloadReport?: (() => Promise<void>) | undefined;
}) {
  const [result, setResult] = useState<SessionList>({ kind: 'loading' });
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);
  const workspaceId = document.workspace?.id;

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const { signal } = controller;
    void connection.listSessions(signal).then((sessions) => {
      if (signal.aborted) return;
      setResult(sessions
        ? { kind: 'ready', sessions: sessions.sort((left, right) => right.updatedAt - left.updatedAt) }
        : { kind: 'unavailable' });
    }).catch(() => {
      if (!signal.aborted) setResult({ kind: 'error' });
    });
    return () => controller.abort();
  }, [connection, workspaceId, request]);

  function refresh() {
    setResult({ kind: 'loading' });
    setOpenError(false);
    setRequest((previous) => previous + 1);
  }

  async function open(id: string) {
    if (id === document.id || saving || opening) return;
    setOpening(id);
    setOpenError(false);
    try {
      await connection.openSession(id);
    } catch {
      setOpenError(true);
    } finally {
      setOpening(null);
    }
  }

  const sessions = result.kind === 'ready' ? result.sessions : [];
  const normalized = query.trim().toLocaleLowerCase('ru-RU');
  const visible = sessions.filter(({ title, updatedAt }) =>
    title.toLocaleLowerCase('ru-RU').includes(normalized) || dateFormat.format(updatedAt).includes(normalized),
  );

  return (
    <main>
      <header>
        <h1>История сеансов</h1>
        {document.workspace && <p>Общие сеансы пространства «{document.workspace.name}»</p>}
      </header>
      {onDownloadReport && (
        <Button className="secondary" onClick={() => void onDownloadReport()}>Скачать исходный MIN/MAX</Button>
      )}
      {!document.workspace ? (
        <p>Список общих сеансов доступен из командного документа Буста.</p>
      ) : result.kind === 'unavailable' ? (
        <p>Для просмотра и открытия общих сеансов здесь требуется обновление AppBox. Сеансы доступны в «Моих документах».</p>
      ) : result.kind === 'loading' ? (
        <p role="status">Загрузка сеансов…</p>
      ) : (
        <>
          <div className="filters compact-filters">
            {sessions.length > 0 && (
              <label className="filter-search">Поиск по названию или дате обновления
                <SearchInput value={query} onValueChange={setQuery} />
              </label>
            )}
            <Button className="secondary" onClick={refresh} disabled={opening !== null}>
              {result.kind === 'error' ? 'Повторить загрузку' : 'Обновить список'}
            </Button>
          </div>
          {openError && <Alert tone="danger">Не удалось открыть сеанс. Попробуйте ещё раз.</Alert>}
          {result.kind === 'error' ? (
            <Alert tone="danger">Не удалось загрузить список сеансов.</Alert>
          ) : sessions.length === 0 ? (
            <p>Сохранённых сеансов пока нет.</p>
          ) : (
            <VirtualTable
              rows={visible}
              getRowKey={({ id }) => id}
              emptyMessage="По заданному поиску сеансы не найдены."
              columns={[
                { key: 'title', header: 'Сеанс', width: 'minmax(240px, 1fr)', render: ({ title }) => title },
                {
                  key: 'updatedAt', header: 'Последнее обновление', width: '190px',
                  render: ({ updatedAt }) => dateFormat.format(updatedAt),
                },
                {
                  key: 'action', header: 'Действие', width: '155px',
                  render: ({ id, title }) => id === document.id ? 'Текущий сеанс' : (
                    <Button
                      className="secondary"
                      aria-label={`Открыть ${title}`}
                      disabled={saving || opening !== null}
                      onClick={() => void open(id)}
                    >
                      {opening === id ? 'Открываем…' : 'Открыть'}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </main>
  );
}
