import { useState } from 'react';
import { useAppBoxDraft } from '../../app/useAppBoxDraft';
import { Dialog } from '../../components/Dialog';
import { Alert, Button, Input } from '../../components/ui';
import type { CatalogProduct } from '../../domain/supplierCatalog';

export function CatalogProductDialog({ product, onSave, onClose }: {
  product?: CatalogProduct | undefined;
  onSave: (value: CatalogProduct) => Promise<void>;
  onClose: () => void;
}) {
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [article, setArticle] = useState(product?.article ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useAppBoxDraft(code !== (product?.code ?? '') || name !== (product?.name ?? '') ||
    article !== (product?.article ?? '') || unit !== (product?.unit ?? ''), onClose);

  async function save() {
    if (saving || !code.trim() || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ code, name, article, ...(unit.trim() && { unit }) });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить карточку товара.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={product ? 'Карточка товара' : 'Добавить товар'}
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
          <Input value={code} onChange={(event) => setCode(event.target.value)} required readOnly={saving || Boolean(product)} />
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
