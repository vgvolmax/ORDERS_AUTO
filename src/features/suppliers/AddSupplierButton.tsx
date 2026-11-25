import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { currentCatalogLink } from '../../appbox/supplierCatalogBridge';
import { Dialog } from '../../components/Dialog';
import { Alert, Button, Input } from '../../components/ui';
import { addCatalogSupplier } from '../../domain/supplierCatalog';

export function AddSupplierButton() {
  const { state, commit, shared, saving: workspaceSaving } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editor = useRef<HTMLDivElement>(null);
  const readOnly = shared ? shared.catalogReadOnly || shared.sourceUnavailable || !shared.editable
    : currentCatalogLink()?.document?.canEdit === false;

  useLayoutEffect(() => {
    if (open) editor.current?.querySelector('input')?.focus();
  }, [open]);

  async function add() {
    if (!commit || !name.trim() || readOnly || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await commit((current) => {
        if (currentCatalogLink()?.document?.canEdit === false)
          throw new Error('Общий справочник доступен только для чтения.');
        if (!current.catalog || current.workspaceId !== state.workspaceId)
          throw new Error('Справочник изменился. Откройте форму заново.');
        return {
          catalog: addCatalogSupplier(current.catalog, name),
          toast: 'Поставщик добавлен в справочник.',
        };
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось добавить поставщика.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!state.catalog || !commit) return null;
  return (
    <>
      <Button
        className="secondary"
        disabled={workspaceSaving || readOnly}
        title={readOnly ? 'Общий справочник доступен только для чтения' : undefined}
        onClick={() => {
          setName('');
          setError('');
          setOpen(true);
        }}
      >
        Добавить поставщика
      </Button>
      {open && (
        <Dialog
          title="Добавить поставщика"
          onClose={() => { if (!savingRef.current) setOpen(false); }}
          actions={
            <Button
              type="button"
              disabled={saving || readOnly || !name.trim()}
              onClick={() => void add()}
            >
              {saving ? 'Добавление…' : 'Добавить'}
            </Button>
          }
        >
          <div ref={editor} className="add-supplier-form" aria-busy={saving}>
            <label>
              Наименование поставщика
              <Input
                value={name}
                required
                readOnly={saving}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void add();
                }}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                  setError('');
                }}
              />
            </label>
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        </Dialog>
      )}
    </>
  );
}
