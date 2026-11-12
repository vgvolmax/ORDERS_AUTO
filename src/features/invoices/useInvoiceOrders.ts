import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../app/appStore';
import { selectInvoiceOrders, type InvoiceOrder } from '../../app/invoiceOrders';
import { stateFromWorkspace } from '../../app/workspaceSession';
import { attachSupplierCatalog } from '../../app/catalogSession';
import { loadSupplierCatalog } from '../../persistence/supplierCatalog';
import type { WorkspaceMetadata } from '../../domain/workspace';
import { listWorkspaces, loadWorkspace, readActiveWorkspaceRevision } from '../../persistence/workspaces';

type ArchiveOrders =
  | { id: string; orders: InvoiceOrder[]; skuCodes: readonly string[]; error?: never }
  | { id: string; orders?: never; skuCodes?: never; error: string };

const noOrders: readonly InvoiceOrder[] = [];
const noSkuCodes: readonly string[] = [];

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
        const archivedState = attachSupplierCatalog(stateFromWorkspace(workspace), state.catalog);
        const orders = selectInvoiceOrders(archivedState);
        const skuCodes = archivedState.minMax?.skus.map(({ code }) => code) ?? noSkuCodes;
        if (current) setArchive({ id: archiveId, orders, skuCodes });
      })
      .catch(() => {
        if (current) setArchive({ id: archiveId, error: 'Не удалось открыть заказы этого сеанса. Выберите другой сеанс.' });
      });
    return () => { current = false; };
  }, [archiveId, state.catalog]);

  const currentOrders = useMemo(() => selectInvoiceOrders(state), [state]);
  const currentSkuCodes = useMemo(() => state.minMax?.skus.map(({ code }) => code) ?? noSkuCodes, [state.minMax]);
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
    skuCodes: archiveId ? selectedArchive?.skuCodes ?? noSkuCodes : currentSkuCodes,
    loading: Boolean(archiveId && !selectedArchive),
    error: selectedArchive?.error ?? '',
    historyError,
    verifySource: async () => {
      if (state.catalog && (await loadSupplierCatalog())?.revision !== state.catalog.revision) {
        throw new Error('Справочник изменился. Обновите страницу и повторите сверку.');
      }
      if (archiveId) return;
      const active = await readActiveWorkspaceRevision();
      if (active?.workspaceId !== currentId || active.revision !== currentRevision) {
        throw new Error('Сеанс изменился. Обновите страницу и выберите заказы заново.');
      }
    },
  };
}
