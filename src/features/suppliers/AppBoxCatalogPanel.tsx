import { useState } from 'react';
import { useStore } from '../../app/appStore';
import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import type { CatalogBase, CatalogChange } from '../../domain/catalogChange';
import {
  parseSharedCatalog, sharedCatalogFromLocal, sharedCatalogJson, SHARED_CATALOG_FILENAME,
  type SharedSupplierCatalog,
} from '../../domain/sharedSupplierCatalog';
import { save } from '../../export/download';

export function AppBoxCatalogPanel() {
  const { state, shared, saving } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restore, setRestore] = useState<{ backup: SharedSupplierCatalog; base: CatalogBase; name: string } | null>(null);
  if (!shared) return null;
  const editor = !shared.catalogReadOnly;
  const hasCatalog = shared.catalogRevision !== null;

  async function change(command: CatalogChange, message: string, base?: CatalogBase) {
    if (!shared || !editor || busy) return;
    setBusy(true);
    setError('');
    try {
      await shared.changeCatalog(command, message, base);
      setRestore(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить справочник.');
    } finally {
      setBusy(false);
    }
  }

  async function selectBackup(file: File) {
    if (!shared || !editor || busy) return;
    setBusy(true);
    setError('');
    try {
      setRestore({
        backup: parseSharedCatalog(await file.text()),
        base: { catalog: state.catalog, catalogRevision: shared.catalogRevision },
        name: file.name,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать резервную копию.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shared-catalog-panel panel" aria-label="Справочник AppBox">
      <h2>Справочник AppBox</h2>
      <p className="muted">
        {shared.sourceUnavailable ? 'Источник недоступен. Проверьте подключение в AppBox.' :
          shared.sourceConnected ? 'Подключён общий справочник отдела. Откройте исходный документ, чтобы изменить товары и связи.' :
            shared.team ? 'Администратор подключает общий справочник в разделе «Источники» AppBox.' :
              hasCatalog ? editor ? 'Изменения в справочнике сохраняются в AppBox и видны в подключённых сеансах.'
                : 'Справочник доступен для просмотра.' :
                'Создайте справочник в этом документе или восстановите его из резервной копии.'}
      </p>
      {editor && !hasCatalog && (
        <div className="shared-catalog-actions">
          <Button disabled={busy || saving} onClick={() => void change({ kind: 'create' }, 'Справочник создан.')}>
            Создать справочник
          </Button>
        </div>
      )}
      {(hasCatalog || editor) && (
        <details>
          <summary>Резервная копия</summary>
          <div className="shared-catalog-actions">
            {state.catalog && hasCatalog && (
              <Button className="secondary" disabled={busy || saving} onClick={() => {
                const content = sharedCatalogJson(sharedCatalogFromLocal(state.catalog!));
                save(new Blob([content], { type: 'application/json;charset=utf-8' }), SHARED_CATALOG_FILENAME);
              }}>Скачать копию JSON</Button>
            )}
            {editor && (
              <label>
                Восстановить из JSON
                <input
                  type="file" accept=".json,application/json" disabled={busy || saving}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void selectBackup(file);
                  }}
                />
              </label>
            )}
          </div>
        </details>
      )}
      {error && !restore && <Alert tone="danger">{error}</Alert>}
      {busy && <p role="status">Сохраняем справочник…</p>}
      {restore && (
        <Dialog title="Восстановить справочник из копии?" onClose={() => { if (!busy) setRestore(null); }} actions={
          <>
            <Button className="secondary" disabled={busy} onClick={() => setRestore(null)}>Отмена</Button>
            <Button disabled={busy || saving} onClick={() => void change(
              { kind: 'restore', backup: restore.backup }, 'Справочник восстановлен из копии.', restore.base,
            )}>Восстановить</Button>
          </>
        }>
          <p>Файл «{restore.name}» заменит список товаров, поставщиков и связей в этом документе и во всех подключённых сеансах.</p>
          {error && <Alert tone="danger">{error}</Alert>}
        </Dialog>
      )}
    </section>
  );
}
