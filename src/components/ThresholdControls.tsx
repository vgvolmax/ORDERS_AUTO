import type { OrderSettings, ThresholdMode } from '../domain/types';
import { useDurableDraft } from '../app/useDurableDraft';
import { QuantityInput } from './QuantityInput';
import { Select } from './ui';

export function ThresholdControls({
  settings,
  onChange,
  showBelowThreshold,
  onShowBelowThresholdChange,
}: {
  settings: OrderSettings;
  onChange: (settings: OrderSettings) => void | Promise<void>;
  showBelowThreshold: boolean;
  onShowBelowThresholdChange: (show: boolean) => void;
}) {
  const [draft, change] = useDurableDraft(settings, 'order-settings', (next) =>
    Promise.resolve(onChange(next)),
  );
  return (
    <section className="settings" aria-label="Порог закупки">
      <label>
        Минимальная сумма закупки, ₽
        <QuantityInput
          step={100}
          value={draft.minimumOrderAmount}
          onCommit={(minimumOrderAmount) =>
            change({ ...draft, minimumOrderAmount })
          }
        />
      </label>

      <label>
        Порог считать
        <Select
          value={draft.thresholdMode}
          onChange={(event) =>
            change({
              ...draft,
              thresholdMode: event.target.value as ThresholdMode,
            })
          }
        >
          <option value="SUPPLIER_TOTAL">По поставщику в целом</option>
          <option value="BRANCH_SUPPLIER">
            По заказу подразделение → поставщик
          </option>
        </Select>
      </label>

      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={showBelowThreshold}
          onChange={(event) => onShowBelowThresholdChange(event.target.checked)}
        />
        Показывать ниже порога
      </label>
    </section>
  );
}
