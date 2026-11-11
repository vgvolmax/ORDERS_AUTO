import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import type { TransferQuantityDetails } from '../../domain/rebalancing/manualTransferQuantity';
import { fmtQty, money } from '../demand/DemandPage';
import type { TransferDocumentLine } from './transferDocuments';

export type ReadTransferQuantity = (
  sourceLineId: string,
  qty?: number,
) => TransferQuantityDetails | null;

export function TransferQuantityEditor({
  line,
  draft,
  disabled,
  quantityDetails,
  onDraft,
  onSave,
}: {
  line: TransferDocumentLine;
  draft: string | undefined;
  disabled: boolean;
  quantityDetails: ReadTransferQuantity | undefined;
  onDraft: (value: string | undefined) => void;
  onSave: (sourceLineId: string, qty: number) => Promise<void>;
}) {
  const feedbackId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const restoreFocus = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { originalQty } = line;
  const manual = originalQty !== undefined && originalQty !== line.qty;
  useLayoutEffect(() => {
    if (saving || disabled || !restoreFocus.current) return;
    restoreFocus.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [disabled, saving]);
  const qty = Number(draft);
  const validQty = Number.isSafeInteger(qty) && qty > 0;
  const details =
    draft !== undefined && validQty
      ? quantityDetails?.(line.sourceLineId, qty)
      : draft === undefined && reviewing && manual
        ? quantityDetails?.(line.sourceLineId)
        : undefined;
  const unit = line.unit ?? 'ед.';
  let validation = '';
  if (draft !== undefined) {
    if (!validQty) validation = 'Введите целое количество больше нуля.';
    else if (details === null) validation = 'Количество недоступно для правки.';
    else if (details && qty > details.maxQty) {
      validation = `Максимум для этого направления: ${fmtQty(details.maxQty)} ${unit}.`;
    }
  }
  const error = validation || saveError;
  const warnings = details && !validation ? transferQuantityWarnings(details) : [];

  return (
    <form
      className="transfer-quantity"
      noValidate
      aria-busy={saving}
      onFocus={() => setReviewing(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setReviewing(false);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (draft === undefined || validation || disabled || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setSaveError('');
        try {
          await onSave(line.sourceLineId, qty);
          onDraft(undefined);
        } catch (cause) {
          setSaveError(cause instanceof Error ? cause.message : 'Количество не сохранено.');
        } finally {
          savingRef.current = false;
          restoreFocus.current = true;
          setSaving(false);
        }
      }}
    >
      <input
        ref={inputRef}
        type="number"
        className="input"
        min={1}
        max={details?.maxQty}
        step={1}
        aria-label={`Количество ${line.skuCode}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error || warnings.length ? feedbackId : undefined}
        value={draft ?? line.qty}
        disabled={disabled || saving}
        onChange={(event) => {
          setSaveError('');
          const value = event.currentTarget.value;
          onDraft(value === String(line.qty) ? undefined : value);
        }}
      />
      <small>Ед. изм.: {unit}</small>
      {manual && (
        <small className="transfer-manual-qty">Вручную · расчёт {fmtQty(originalQty)}</small>
      )}
      {draft !== undefined && (
        <div className="transfer-quantity-actions">
          <Button
            type="submit"
            className="secondary"
            aria-label={`Сохранить количество ${line.skuCode}`}
            disabled={disabled || saving || Boolean(validation)}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
          <button
            className="link"
            type="button"
            aria-label={`Отменить правку количества ${line.skuCode}`}
            disabled={saving}
            onClick={() => {
              onDraft(undefined);
              setSaveError('');
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            Отмена
          </button>
        </div>
      )}
      {(error || warnings.length > 0) && (
        <div id={feedbackId} className="transfer-quantity-feedback">
          {error && <small className="danger-text" role="alert">{error}</small>}
          {warnings.length > 0 && (
            <ul className="warning-text">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

export function transferQuantityWarnings(details: TransferQuantityDetails) {
  const warnings: string[] = [];
  const { donorAfter, donorMax, recipientAfter, recipientMax, recipientTarget } = details;
  if (donorMax !== null && donorAfter < donorMax)
    warnings.push(`Остаток отправителя ниже MAX: ${fmtQty(donorAfter)} из ${fmtQty(donorMax)}.`);
  if (recipientMax !== null && recipientAfter > recipientMax)
    warnings.push(`Остаток получателя выше MAX: ${fmtQty(recipientAfter)} при MAX ${fmtQty(recipientMax)}.`);
  else if (recipientTarget !== null && recipientAfter > recipientTarget)
    warnings.push(`Остаток получателя выше цели: ${fmtQty(recipientAfter)} при цели ${fmtQty(recipientTarget)}.`);
  if (details.belowAmountThreshold && details.amountThreshold !== null)
    warnings.push(
      details.amount === null
        ? `Нельзя проверить порог ${money(details.amountThreshold)}: нет цены.`
        : `Сумма ниже порога: ${money(details.amount)} при пороге ${money(details.amountThreshold)}.`,
    );
  return warnings;
}
