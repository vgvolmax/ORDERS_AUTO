import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { Button } from '../../components/ui';
import { Dialog } from '../../components/Dialog';
import { snapshotSupplierContext } from '../../domain/supplierContext';
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

import { AppBoxCatalogPanel } from './AppBoxCatalogPanel';

const message = (error: unknown): string => error instanceof Error ? error.message : 'Операция со справочником не выполнена.';

export function SharedCatalogPanel({ compact = false }: { compact?: boolean }) {
  const { shared } = useStore();
  return shared ? <AppBoxCatalogPanel /> : <LocalCatalogPanel compact={compact} />;
}

function LocalCatalogPanel({ compact }: { compact: boolean }) {
  const { state, commit, saving } = useStore();
  const [link, setLink] = useState<SharedCatalogLink | null>(currentCatalogLink);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ message: string; action: string } | null>(null);
  const [showControls, setShowControls] = useState(false);
  const controlsId = useId();
  const resolveConfirmation = useRef<((approved: boolean) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const latestCatalog = useRef(state.catalog);
  latestCatalog.current = state.catalog;
  useEffect(() => () => { resolveConfirmation.current?.(false); resolveConfirmation.current = null; }, []);
  function approve(message: string, action: string): Promise<boolean> {
    return new Promise((resolve) => {
      resolveConfirmation.current = resolve;
      setConfirmation({ message, action });
    });
  }
  function answerConfirmation(approved: boolean) {
    resolveConfirmation.current?.(approved);
    resolveConfirmation.current = null;
    setConfirmation(null);
  }
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
    const incoming = applySharedCatalog(state.catalog, document, state.minMax?.skus ?? []);
    const replacesUnlinked = !link && state.catalog && currentJson !== sharedCatalogJson(sharedCatalogFromLocal(incoming));
    const existingLinks = JSON.stringify(state.catalog?.assignments ?? []);
    const incomingLinks = JSON.stringify(document.assignments);
    const previousContext = state.supplierContext ?? (state.catalog ? snapshotSupplierContext(state.catalog) : null);
    const incomingContext = snapshotSupplierContext(incoming);
    const affectsReviewed = (state.reviewedOrderIds.length || state.exportedOrderIds.length) &&
      (existingLinks !== incomingLinks || JSON.stringify(previousContext) !== JSON.stringify(incomingContext));
    if (dirty || replacesUnlinked || affectsReviewed) {
      const warning = [
        dirty || replacesUnlinked
          ? 'Открываемый JSON отличается от локального справочника. В нём могут быть неопубликованные изменения. Заменить локальный справочник?'
          : '',
        affectsReviewed ? 'Связи поставщиков или единицы изменятся. Проверка и отметки выгрузки затронутых заказов будут сняты.' : '',
      ].filter(Boolean).join(' ');
      if (!(await approve(warning, 'Заменить локальную копию'))) return;
    }
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
    const next = { document: reference, baseline: sharedCatalogJson(document), openedAt: new Date().toISOString() };
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
      if (!link && !(await approve('Общий документ не подключён. Сохранение создаст новый JSON в AppBox, а не обновит старый. Продолжить?', 'Создать документ в AppBox'))) return;
      const snapshot = sharedCatalogFromLocal(state.catalog!);
      ensureAppBoxSize(snapshot);
      const content = sharedCatalogJson(snapshot);
      const result = await api.save(snapshot, {
        filename: SHARED_CATALOG_FILENAME,
        document: link?.document ?? null,
      });
      if (!result) return;
      if (result.destination === 'computer') {
        setNotice('Запрошено скачивание на компьютер. Общий справочник AppBox НЕ обновлён.');
        return;
      }
      if (!result.document) throw new Error('AppBox не вернул ссылку на сохранённый документ. Проверьте библиотеку файлов.');
      const next = {
        ...link, document: result.document, baseline: content, publishedAt: new Date().toISOString(),
      };
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

  const canCollapse = compact && Boolean(state.catalog);
  const expanded = !canCollapse || showControls;
  const publishButton = bridge && (
    <Button disabled={busy || saving || !state.catalog || readOnly || (Boolean(link) && !dirty)} onClick={saveAppBox}>
      Сохранить в AppBox
    </Button>
  );

  return (
    <section className={`shared-catalog-panel panel${canCollapse ? ' shared-catalog-compact' : ''}`} aria-label="Общий справочник JSON">
      <div className="shared-catalog-heading">
        <div>
          <h2>Общий справочник JSON</h2>
          {state.catalog ? <p className="muted">На этом ПК: сохранён
            {bridge && <> · AppBox: <span className={dirty && !readOnly ? 'warning-text' : undefined}>
              {link
                ? readOnly ? 'Только чтение' : dirty ? 'Есть локальные изменения' : 'Синхронизирован'
                : 'Общий документ не подключён'}
            </span></>}
          </p> : <p className="muted">{bridge ? 'Общий документ не подключён' : 'Источник ещё не выбран'}</p>}
        </div>
        {canCollapse && <div className="shared-catalog-actions">
          {!expanded && dirty && !readOnly && publishButton}
          <Button className="secondary" aria-expanded={expanded} aria-controls={controlsId}
            onClick={() => setShowControls(!expanded)}>
            {expanded ? 'Свернуть управление' : 'Управление справочником'}
          </Button>
        </div>}
      </div>
      <div id={controlsId} className="shared-catalog-details" hidden={!expanded}>
        <div className="shared-catalog-actions">
          {bridge && <Button className="secondary" disabled={busy || saving} onClick={openAppBox}>
            {link ? 'Открыть / обновить из AppBox' : 'Открыть из AppBox'}
          </Button>}
          {expanded && publishButton}
          <Button className="secondary" disabled={busy || saving} onClick={() => input.current?.click()}>
            Импорт JSON с компьютера
          </Button>
          <Button className="secondary" disabled={busy || saving || !state.catalog} onClick={download}>
            Скачать резервную копию
          </Button>
        </div>
        {state.catalog && <p className="muted">
          {state.catalog.products.length} товаров · {(state.catalog.suppliers ?? []).length} поставщиков ·
          {' '}{state.catalog.assignments.filter((item) => item.primary).length} основных назначений.
        </p>}
        {bridge && link?.document && <p className="muted">
          {typeof link.document.name === 'string' ? link.document.name : 'Общий документ AppBox'}
          {link.openedAt && ` · открыт ${new Date(link.openedAt).toLocaleString('ru-RU')}`}
          {link.publishedAt && ` · опубликовано ${new Date(link.publishedAt).toLocaleString('ru-RU')}`}
        </p>}
      </div>
      <input
        ref={input} type="file" accept=".json,application/json" hidden
        aria-label="Файл справочника JSON"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onComputerFile(file);
        }}
      />
      {readOnly && <p className="muted">Редактирование связей недоступно: у общего документа права только на чтение.</p>}
      {error && <p role="alert" className="danger-text">{error}</p>}
      {notice && <p role="status" className="muted">{notice}</p>}
      {confirmation && (
        <Dialog
          title="Подтвердить обновление справочника"
          onClose={() => answerConfirmation(false)}
          actions={
            <>
              <Button className="secondary" onClick={() => answerConfirmation(false)}>Отмена</Button>
              <Button onClick={() => answerConfirmation(true)}>{confirmation.action}</Button>
            </>
          }
        >
          <p>{confirmation.message}</p>
        </Dialog>
      )}
    </section>
  );
}
