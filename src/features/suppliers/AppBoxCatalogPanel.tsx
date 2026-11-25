import { useState } from 'react';
import { useStore } from '../../app/appStore';
import { Button } from '../../components/ui';
import {
  parseSharedCatalog, sharedCatalogFromLocal, sharedCatalogJson, SHARED_CATALOG_FILENAME,
} from '../../domain/sharedSupplierCatalog';
import { save } from '../../export/download';

export function AppBoxCatalogPanel() {
  const { state, shared, saving } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!shared) return null;
  const editable = shared.editable && !shared.team && !shared.sourceConnected && !shared.sourceUnavailable;

  async function load(file: File) {
    if (!shared || !editable || busy) return;
    setBusy(true);
    setError('');
    try {
      await shared.updateCatalog(parseSharedCatalog(await file.text()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить справочник.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shared-catalog-panel panel" aria-label="Справочник AppBox">
      <h2>Справочник AppBox</h2>
      <p className="muted">
        {shared.sourceUnavailable ? 'Источник недоступен. Проверьте подключение в AppBox.' :
          shared.sourceConnected ? 'Подключён общий справочник отдела. Изменения вносятся в исходном документе.' :
            shared.team ? 'Администратор подключает общий справочник в разделе «Источники» AppBox.' :
              state.catalog ? 'Справочник этого документа. Обновите его импортом новой версии JSON.' :
              'Подключите источник в «Моих документах» или загрузите JSON для этого документа.'}
      </p>
      <div className="shared-catalog-actions">
        {editable && (
          <label>
            Загрузить JSON справочника в AppBox
            <input
              type="file" accept=".json,application/json" disabled={busy || saving}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void load(file);
              }}
            />
          </label>
        )}
        {state.catalog && (
          <Button className="secondary" disabled={busy} onClick={() => {
            const content = sharedCatalogJson(sharedCatalogFromLocal(state.catalog!));
            save(new Blob([content], { type: 'application/json;charset=utf-8' }), SHARED_CATALOG_FILENAME);
          }}>Скачать JSON справочника</Button>
        )}
      </div>
      {error && <p className="danger-text" role="alert">{error}</p>}
      {busy && <p role="status">Сохраняем справочник…</p>}
    </section>
  );
}
