import { Button } from '../../components/ui';
import { fmtQty } from '../../format/numbers';
import type { ParsedInvoiceSheet } from '../../import/invoiceParser';

export function InvoiceSheets({
  sheets, selectedNames, applied, disabled, onChange, onApply,
}: {
  sheets: readonly ParsedInvoiceSheet[];
  selectedNames: readonly string[];
  applied: boolean;
  disabled: boolean;
  onChange: (name: string, included: boolean) => void;
  onApply: () => void;
}) {
  return (
    <fieldset className="invoice-sheets" disabled={disabled}>
      <legend>Листы счёта</legend>
      <p>Отметьте нужные части счёта. Копии и другие счета не включайте.</p>
      <div className="invoice-sheet-options">
        {sheets.map((sheet) => (
          <label key={sheet.name}>
            <input
              type="checkbox"
              checked={selectedNames.includes(sheet.name)}
              disabled={sheet.items.length === 0}
              onChange={(event) => onChange(sheet.name, event.target.checked)}
            />
            <span>
              {sheet.name} <small>Позиций: {fmtQty(sheet.items.length)}</small>
              {sheet.items.length === 0 && (
                <small className="warning-text">Нет распознанных позиций. {sheet.warnings[0]}</small>
              )}
            </span>
          </label>
        ))}
      </div>
      {applied ? <p role="status">Выбранные листы учтены.</p> : (
        <Button disabled={selectedNames.length === 0 || disabled} onClick={onApply}>
          Использовать выбранные листы
        </Button>
      )}
    </fieldset>
  );
}
