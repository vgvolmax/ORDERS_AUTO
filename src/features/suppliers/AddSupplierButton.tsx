import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { currentCatalogLink } from '../../appbox/supplierCatalogBridge';
import { Dialog } from '../../components/Dialog';
import { Alert, Button, Input } from '../../components/ui';
import { addCatalogSupplier } from '../../domain/supplierCatalog';

export function AddSupplierButton() {
  const { state, commit, saving: workspaceSaving } = useStore();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const readOnly = currentCatalogLink()?.document?.canEdit === false;

  useLayoutEffect(() => {
    if (open) form.current?.querySelector('input')?.focus();
  }, [open]);

  async function add() {
    if (!commit || savingRef.current) return;
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
            <Button type="submit" form={formId} disabled={saving || readOnly || !name.trim()}>
              {saving ? 'Добавление…' : 'Добавить'}
            </Button>
          }
        >
          <form
            ref={form}
            id={formId}
            className="add-supplier-form"
            aria-busy={saving}
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <label>
              Наименование поставщика
              <Input
                value={name}
                required
                readOnly={saving}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                  setError('');
                }}
              />
            </label>
            {error && <Alert tone="danger">{error}</Alert>}
          </form>
        </Dialog>
      )}
    </>
  );
}
