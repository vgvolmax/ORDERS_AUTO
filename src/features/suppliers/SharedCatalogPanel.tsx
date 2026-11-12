import { useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { Button } from '../../components/ui';
import { save } from '../../export/download';
import {
  applySharedCatalog,
  ensureAppBoxSize,
  parseSharedCatalog,
  sharedCatalogFromLocal,
  sharedCatalogJson,
  SHARED_CATALOG_FILENAME,
  type SharedSupplierCatalog,
} from '../../domain/sharedSupplierCatalog';
import {
  appBoxFiles, currentCatalogLink, rememberCatalogLink,
  type AppBoxDocumentRef,
  type SharedCatalogLink,
} from '../../appbox/supplierCatalogBridge';

const message = (error: unknown): string => error instanceof Error ? error.message : 'Операция со справочником не выполнена.';

export function SharedCatalogPanel() {
  const { state, commit, saving } = useStore();
  const [link, setLink] = useState<SharedCatalogLink | null>(currentCatalogLink);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const latestCatalog = useRef(state.catalog);
  latestCatalog.current = state.catalog;
  const bridge = appBoxFiles();
  const currentJson = state.catalog ? sharedCatalogJson(sharedCatalogFromLocal(state.catalog)) : null;
  const dirty = link && currentJson !== link.baseline;
  const readOnly = Boolean(link?.document?.canEdit === false);

  async function run(operation: () => Promise<void>) {
    if (inFlight.current || saving) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (reason) { setError(message(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function adopt(document: SharedSupplierCatalog, reference: AppBoxDocumentRef | null) {
    if (!commit) throw new Error('Локальное хранилище недоступно.');
    if (dirty && !window.confirm('Есть локальные изменения справочника, не сохранённые в общий JSON. Заменить их?')) return;
    const existingLinks = JSON.stringify(state.catalog?.assignments ?? []);
    const incomingLinks = JSON.stringify(document.assignments);
    if ((state.reviewedOrderIds.length || state.exportedOrderIds.length) && existingLinks !== incomingLinks &&
        !window.confirm('Связи поставщиков изменятся. Это может снять проверку с затронутых заказов. Продолжить?')) return;
    const workspaceId = state.workspaceId;
    const catalog = state.catalog;
    await commit((current) => {
      if (current.workspaceId !== workspaceId || current.catalog !== catalog) {
        throw new Error('Справочник изменился во время открытия файла. Повторите загрузку.');
      }
      return {
        catalog: applySharedCatalog(current.catalog, document, current.minMax?.skus ?? []),
        supplierAssignments: document.assignments,
        toast: 'Справочник загружен. Связи поставщиков обновлены.',
      };
    });
    const next = { document: reference, baseline: sharedCatalogJson(document) };
    // A computer file is a detached copy; it cannot silently overwrite the old AppBox document.
    rememberCatalogLink(reference ? next : null);
    setLink(reference ? next : null);
    setNotice(reference
      ? 'Общий справочник подключён. После обновления страницы откройте его повторно.'
      : 'JSON загружен как локальная копия. Для публикации используйте «Сохранить в AppBox».');
  }

  function openAppBox() {
    const api = appBoxFiles();
    if (!api) return;
    void run(async () => {
      const result = await api.open();
      if (!result) return; // Cancelling does not change the current catalog or link.
      const document = parseSharedCatalog(result.content);
      await adopt(document, result.document ?? null);
    });
  }

  function saveAppBox() {
    const api = appBoxFiles();
    if (!api || !state.catalog) return;
    void run(async () => {
      if (link?.document?.canEdit === false) throw new Error('У документа нет права редактирования.');
      const snapshot = sharedCatalogFromLocal(state.catalog!);
      ensureAppBoxSize(snapshot);
      const content = sharedCatalogJson(snapshot);
      const result = await api.save(snapshot, {
        filename: SHARED_CATALOG_FILENAME,
        document: link?.document ?? null,
      });
      if (!result) return;
      if (result.destination !== 'appbox' || !result.document) {
        setNotice('Файл выгружен на компьютер. Общий справочник AppBox НЕ обновлён.');
        return;
      }
      const next = { document: result.document, baseline: content };
      rememberCatalogLink(next);
      setLink(next);
      setNotice(content === (latestCatalog.current
        ? sharedCatalogJson(sharedCatalogFromLocal(latestCatalog.current)) : null)
        ? 'Общий справочник сохранён в AppBox.'
        : 'Версия сохранена в AppBox, но появились более поздние локальные изменения. Сохраните их отдельно.');
    });
  }

  function download() {
    if (!state.catalog) return;
    try {
      const content = sharedCatalogJson(sharedCatalogFromLocal(state.catalog));
      save(new Blob([content], { type: 'application/json;charset=utf-8' }), SHARED_CATALOG_FILENAME);
      setError('');
      setNotice('Запрошено скачивание локальной копии. Общий документ AppBox не изменён.');
    } catch (reason) { setError(message(reason)); }
  }

  function onComputerFile(file: File | undefined) {
    if (!file) return;
    void run(async () => {
      const document = parseSharedCatalog(await file.text());
      await adopt(document, null);
    });
  }

  return (
    <section className="shared-catalog-panel panel" aria-label="Общий справочник JSON">
      <div className="shared-catalog-heading">
        <div>
          <h2>Общий справочник JSON</h2>
          <p className="muted">
            {bridge
              ? 'Откройте общий документ AppBox. Изменения в нём сохраняются только по кнопке.'
              : 'Автономный режим: импорт и резервная копия JSON на компьютере.'}
          </p>
        </div>
        <span role="status" className={dirty ? 'warning-text' : 'muted'}>
          {link ? (readOnly ? 'Только чтение' : dirty ? 'Есть локальные изменения' : 'Подключён') : 'Общий документ не подключён'}
        </span>
      </div>
      <div className="shared-catalog-actions">
        {bridge && <Button className="secondary" disabled={busy || saving} onClick={openAppBox}>
          {link ? 'Открыть / обновить из AppBox' : 'Открыть из AppBox'}
        </Button>}
        {bridge && <Button disabled={busy || saving || !state.catalog || readOnly || (Boolean(link) && !dirty)} onClick={saveAppBox}>
          Сохранить в AppBox
        </Button>}
        <Button className="secondary" disabled={busy || saving} onClick={() => input.current?.click()}>
          Импорт JSON с компьютера
        </Button>
        <input
          ref={input} type="file" accept=".json,application/json" hidden
          aria-label="Файл справочника JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            onComputerFile(file);
          }}
        />
        <Button className="secondary" disabled={busy || saving || !state.catalog} onClick={download}>
          Скачать резервную копию
        </Button>
      </div>
      {state.catalog && (
        <p className="muted">
          {state.catalog.products.length} товаров · {(state.catalog.suppliers ?? []).length} поставщиков ·
          {state.catalog.assignments.filter((item) => item.primary).length} основных назначений.
          {bridge && !link && ' После перезапуска AppBox нужно снова открыть общий JSON.'}
        </p>
      )}
      {readOnly && <p className="muted">Редактирование связей недоступно: у общего документа права только на чтение.</p>}
      {error && <p role="alert" className="danger-text">{error}</p>}
      {notice && <p role="status" className="muted">{notice}</p>}
    </section>
  );
}
