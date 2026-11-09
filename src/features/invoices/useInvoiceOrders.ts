import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../app/appStore';
import { selectInvoiceOrders, type InvoiceOrder } from '../../app/invoiceOrders';
import { stateFromWorkspace } from '../../app/workspaceSession';
import type { WorkspaceMetadata } from '../../domain/workspace';
import { listWorkspaces, loadWorkspace, readActiveWorkspaceRevision } from '../../persistence/workspaces';

type ArchiveOrders =
  | { id: string; orders: InvoiceOrder[]; error?: never }
  | { id: string; orders?: never; error: string };

const noOrders: readonly InvoiceOrder[] = [];

export function useInvoiceOrders() {
  const { state } = useStore();
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkspaceMetadata[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [archive, setArchive] = useState<ArchiveOrders | null>(null);
  const currentId = state.workspaceId;
  const currentRevision = state.workspaceRevision;
  const sourceId = archiveId ?? currentId;

  useEffect(() => {
    let current = true;
    void listWorkspaces()
      .then((workspaces) => {
        if (current) {
          setHistory(workspaces);
          setHistoryError('');
        }
      })
      .catch(() => {
        if (current) setHistoryError('Не удалось загрузить историю сеансов.');
      });
    return () => { current = false; };
  }, [currentId]);

  useEffect(() => {
    if (!archiveId) return;
    let current = true;
    setArchive(null);
    void loadWorkspace(archiveId)
      .then((workspace) => {
        if (!workspace) throw new Error('Сеанс не найден');
        const orders = selectInvoiceOrders(stateFromWorkspace(workspace));
        if (current) setArchive({ id: archiveId, orders });
      })
      .catch(() => {
        if (current) setArchive({ id: archiveId, error: 'Не удалось открыть заказы этого сеанса. Выберите другой сеанс.' });
      });
    return () => { current = false; };
  }, [archiveId]);

  const currentOrders = useMemo(() => selectInvoiceOrders(state), [state]);
  const selectedArchive = archive?.id === archiveId ? archive : null;

  return {
    sources: [
      { id: currentId, label: ['Текущий сеанс', state.minMaxFileName].filter(Boolean).join(' · ') },
      ...history.filter((item) => item.workspaceId !== currentId && item.minMaxFileName)
        .map((item) => ({
          id: item.workspaceId,
          label: [item.minMaxFileName, new Date(item.updatedAt).toLocaleString('ru-RU')].join(' · '),
        })),
    ],
    sourceId,
    selectSource: (id: string) => setArchiveId(id === currentId ? null : id),
    orders: archiveId ? selectedArchive?.orders ?? noOrders : currentOrders,
    loading: Boolean(archiveId && !selectedArchive),
    error: selectedArchive?.error ?? '',
    historyError,
    verifySource: async () => {
      if (archiveId) return;
      const active = await readActiveWorkspaceRevision();
      if (active?.workspaceId !== currentId || active.revision !== currentRevision) {
        throw new Error('Сеанс изменился. Обновите страницу и выберите заказы заново.');
      }
    },
  };
}
