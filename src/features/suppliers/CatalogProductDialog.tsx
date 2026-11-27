import { useState } from 'react';
import { useAppBoxDraft } from '../../app/useAppBoxDraft';
import { Dialog } from '../../components/Dialog';
import { Alert, Button, Input } from '../../components/ui';
import type { CatalogProduct } from '../../domain/supplierCatalog';

export function CatalogProductDialog({ onSave, onClose }: {
  onSave: (value: CatalogProduct) => Promise<void>;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [article, setArticle] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useAppBoxDraft(Boolean(code || name || article || unit), onClose);

  async function save() {
    if (saving || !code.trim() || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ code, name, article, ...(unit.trim() && { unit }) });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось добавить товар.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Добавить товар"
      onClose={() => { if (!saving) onClose(); }}
      actions={
        <Button disabled={saving || !code.trim() || !name.trim()} onClick={() => void save()}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      }
    >
      <div className="supplier-dialog-content" aria-busy={saving} onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        void save();
      }}>
        <label className="supplier-dialog-field">Код 1С
          <Input value={code} onChange={(event) => setCode(event.target.value)} required readOnly={saving} />
        </label>
        <label className="supplier-dialog-field">Наименование
          <Input value={name} onChange={(event) => setName(event.target.value)} required readOnly={saving} />
        </label>
        <label className="supplier-dialog-field">Артикул
          <Input value={article} onChange={(event) => setArticle(event.target.value)} readOnly={saving} />
        </label>
        <label className="supplier-dialog-field">Единица измерения
          <Input value={unit} onChange={(event) => setUnit(event.target.value)} readOnly={saving} />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
