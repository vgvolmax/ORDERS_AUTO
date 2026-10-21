import { useEffect, useState } from 'react';
import { useStore } from '../../app/appStore';
import {
  listWorkspaces,
  loadWorkspace,
  loadWorkspaceFile,
} from '../../persistence/workspaces';
import type {
  StoredWorkspace,
  WorkspaceMetadata,
} from '../../domain/workspace';
import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';
import { save } from '../../export/download';
export function WorkspaceHistoryPage() {
  const { state, restore } = useStore();
  const [rows, setRows] = useState<WorkspaceMetadata[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<StoredWorkspace | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listWorkspaces()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled)
          setError('Не удалось прочитать историю. Повторно откройте раздел.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.workspaceId]);
  async function choose(id: string) {
    setBusy(true);
    setError('');
    try {
      const w = await loadWorkspace(id);
      if (!w) throw new Error('Сеанс не найден');
      setSelected(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть сеанс');
    } finally {
      setBusy(false);
    }
  }
  async function original(id: string, kind: 'minMax' | 'suppliers') {
    setBusy(true);
    setError('');
    try {
      const w = await loadWorkspace(id),
        ref = w?.data.rawImports[kind];
      if (!ref) throw new Error('Исходный файл в этом сеансе отсутствует');
      const file = await loadWorkspaceFile(ref.fileId);
      if (!file) throw new Error('Не удалось прочитать исходный файл');
      save(new Blob([file.bytes], { type: file.type }), file.name);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось выгрузить исходный файл',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <p className="eyebrow">Сохранённая работа</p>
        <h1>История сеансов</h1>
        <p>
          Каждая замена отчёта создаёт новый снимок. Старые данные и решения
          сохраняются на этом компьютере. Восстановление открывает копию
          сохранённого сеанса.
        </p>
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      {loading ? (
        <p role="status">Загрузка истории…</p>
      ) : (
        <VirtualTable
          rows={rows}
          getRowKey={(w) => w.workspaceId}
          columns={[
            {
              key: 'date',
              header: 'Последнее сохранение',
              width: '220px',
              render: (w) =>
                new Date(w.updatedAt).toLocaleString('ru-RU', {
                  timeZoneName: 'short',
                }),
            },
            {
              key: 'files',
              header: 'Исходные отчёты',
              width: 'minmax(260px, 1fr)',
              render: (w) => (
                <>
                  {w.minMaxFileName ?? 'Без MIN/MAX'}
                  <br />
                  {w.supplierFileName ?? 'Без отчёта поставщиков'}
                </>
              ),
            },
            {
              key: 'status',
              header: 'Сеанс',
              width: '130px',
              render: (w) =>
                w.workspaceId === state.workspaceId ? 'Текущий' : 'Сохранённый',
            },
            {
              key: 'actions',
              header: 'Действия',
              width: '330px',
              render: (w) => (
                <div className="history-actions">
                  <Button
                    className="secondary"
                    disabled={
                      busy || w.workspaceId === state.workspaceId || !restore
                    }
                    onClick={() => choose(w.workspaceId)}
                  >
                    Восстановить
                  </Button>
                  <button
                    className="link"
                    disabled={busy || !w.minMaxFileName}
                    onClick={() => original(w.workspaceId, 'minMax')}
                  >
                    MIN/MAX
                  </button>
                  <button
                    className="link"
                    disabled={busy || !w.supplierFileName}
                    onClick={() => original(w.workspaceId, 'suppliers')}
                  >
                    Поставщики
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}
      {selected && (
        <Dialog
          title="Восстановить сохранённый сеанс?"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
          actions={
            <>
              <Button
                className="secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Отмена
              </Button>
              <Button
                disabled={busy || !restore}
                onClick={async () => {
                  if (!restore || busy) return;
                  setBusy(true);
                  try {
                    await restore(selected);
                    setSelected(null);
                  } catch {
                    setError(
                      'Восстановление не сохранено. Текущий сеанс не изменён. Повторите действие.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Сохранение…' : 'Восстановить копию'}
              </Button>
            </>
          }
        >
          <p>
            {selected.data.minMaxFileName} · {selected.data.supplierFileName}
          </p>
          <p>
            Принятых перемещений: {selected.data.rebalance.accepted.length}.
            Ручных количеств: {selected.data.edits.length}. Заказы будут
            сформированы по сохранённому снимку, а текущая работа останется в
            истории.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
        </Dialog>
      )}
    </main>
  );
}
