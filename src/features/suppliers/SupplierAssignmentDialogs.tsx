import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Alert, Button, Select } from '../../components/ui';
import type { SupplierAssignment, SupplierAssignmentCommand } from '../../domain/supplierAssignments';
import { SUPPLIER_POOL } from '../../domain/supplierPool';
import type { Sku } from '../../domain/types';

interface SaveProps {
  saving: boolean;
  error: string;
  onSave: (command: SupplierAssignmentCommand, success: string) => Promise<boolean>;
  onClose: () => void;
}

function SupplierChoice({
  label,
  value,
  onChange,
  options = SUPPLIER_POOL,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (supplier: string) => void;
  options?: readonly string[];
  disabled: boolean;
}) {
  return (
    <label className="supplier-dialog-field">
      {label}
      <Select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Выберите поставщика</option>
        {options.map((supplier) => <option key={supplier}>{supplier}</option>)}
      </Select>
    </label>
  );
}

export function ProductSupplierDialog({
  product,
  assignment,
  saving,
  error,
  onDismissError,
  onSave,
  onClose,
}: SaveProps & {
  product: Sku;
  assignment: SupplierAssignment | undefined;
  onDismissError: () => void;
}) {
  const [primary, setPrimary] = useState('');
  const [additional, setAdditional] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const currentPrimary = assignment?.primary;
  const extras = assignment?.additional ?? [];
  const extraChoices = SUPPLIER_POOL.filter((supplier) => supplier !== currentPrimary && !extras.includes(supplier));

  async function changePrimary(supplier: string | null) {
    const saved = await onSave(
      { kind: 'set-primary', skuCodes: [product.code], supplier },
      supplier ? 'Основной поставщик назначен.' : 'Основной поставщик снят.',
    );
    if (saved) {
      setPrimary('');
      setConfirmClear(false);
    }
  }

  function closeConfirmation() {
    if (saving) return;
    setConfirmClear(false);
    onDismissError();
  }

  return (
    <>
      <Dialog
        title="Связи товара"
        onClose={onClose}
        actions={<Button className="secondary" disabled={saving} onClick={onClose}>Закрыть</Button>}
      >
        <div className="supplier-dialog-content" aria-busy={saving}>
          <div>
            <strong>{product.name}</strong>
            <p>Код 1С {product.code}{product.article && ` · Артикул ${product.article}`}</p>
          </div>
          <section aria-label="Текущий основной поставщик">
            <h3>Основной</h3>
            <p>{currentPrimary ?? 'Не назначен'}</p>
            <div className="supplier-dialog-controls">
              <SupplierChoice label="Основной поставщик" value={primary} onChange={setPrimary} disabled={saving} />
              <Button disabled={saving || !primary || primary === currentPrimary} onClick={() => void changePrimary(primary)}>
                Сделать основным
              </Button>
            </div>
            {currentPrimary && (
              <>
                <p>При замене прежний основной останется дополнительным.</p>
                <Button className="secondary" disabled={saving} onClick={() => { onDismissError(); setConfirmClear(true); }}>
                  Снять основного
                </Button>
              </>
            )}
          </section>
          <section aria-label="Текущие дополнительные поставщики">
            <h3>Дополнительные</h3>
            {extras.length ? (
              <ul className="supplier-extra-list">
                {extras.map((supplier) => (
                  <li key={supplier}>
                    <span>{supplier}</span>
                    <Button
                      className="secondary"
                      aria-label={`Удалить ${supplier}`}
                      disabled={saving}
                      onClick={() => void onSave(
                        { kind: 'remove-additional', skuCode: product.code, supplier },
                        'Дополнительная связь удалена.',
                      )}
                    >
                      Удалить
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Дополнительных поставщиков пока нет.</p>
            )}
            <div className="supplier-dialog-controls">
              <SupplierChoice
                label="Дополнительный поставщик"
                value={additional}
                onChange={setAdditional}
                options={extraChoices}
                disabled={saving || !extraChoices.length}
              />
              <Button
                className="secondary"
                disabled={saving || !extraChoices.includes(additional)}
                onClick={async () => {
                  if (await onSave(
                    { kind: 'add-additional', skuCode: product.code, supplier: additional },
                    'Дополнительный поставщик добавлен.',
                  )) setAdditional('');
                }}
              >
                Добавить
              </Button>
            </div>
          </section>
          {saving && !confirmClear && <p role="status">Сохраняем связи…</p>}
          {error && !confirmClear && <Alert tone="danger">{error}</Alert>}
        </div>
      </Dialog>
      {confirmClear && (
        <Dialog
          title="Снять основного поставщика"
          onClose={closeConfirmation}
          actions={
            <>
              <Button className="secondary" disabled={saving} onClick={closeConfirmation}>Отмена</Button>
              <Button disabled={saving} onClick={() => void changePrimary(null)}>Снять</Button>
            </>
          }
        >
          <p>Для товара {product.code} заказ перестанет формироваться до нового назначения.</p>
          {saving && <p role="status">Сохраняем связи…</p>}
          {error && <Alert tone="danger">{error}</Alert>}
        </Dialog>
      )}
    </>
  );
}

export function BulkSupplierDialog({
  skuCodes,
  assignmentsByCode,
  saving,
  error,
  onSave,
  onClose,
}: SaveProps & {
  skuCodes: string[];
  assignmentsByCode: ReadonlyMap<string, SupplierAssignment>;
}) {
  const [supplier, setSupplier] = useState('');
  const primaries = skuCodes.map((skuCode) => assignmentsByCode.get(skuCode)?.primary ?? null);
  const replacements = supplier ? primaries.filter((primary) => primary && primary !== supplier).length : 0;
  const firstAssignments = supplier ? primaries.filter((primary) => !primary).length : 0;

  return (
    <Dialog
      title="Назначить основного выбранным"
      onClose={onClose}
      actions={
        <>
          <Button className="secondary" disabled={saving} onClick={onClose}>Отмена</Button>
          <Button
            disabled={saving || !supplier || replacements + firstAssignments === 0}
            onClick={() => void onSave(
              { kind: 'set-primary', skuCodes, supplier },
              `Основной поставщик назначен для товаров: ${replacements + firstAssignments}.`,
            )}
          >
            Назначить
          </Button>
        </>
      }
    >
      <div className="supplier-dialog-content" aria-busy={saving}>
        <p>Выбрано товаров: {skuCodes.length}</p>
        <SupplierChoice label="Основной поставщик" value={supplier} onChange={setSupplier} disabled={saving} />
        {supplier && (
          <div role="status">
            <p>Будет назначено товарам без основного: {firstAssignments}</p>
            <p>Будет заменено основных: {replacements}</p>
            <p>Прежние основные поставщики останутся дополнительными.</p>
          </div>
        )}
        {saving && <p role="status">Сохраняем связи…</p>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
