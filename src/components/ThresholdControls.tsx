import type { OrderSettings, ThresholdMode } from '../domain/types';
import { Input, Select } from './ui';

export function ThresholdControls({
  settings,
  onChange,
  showBelowThreshold,
  onShowBelowThresholdChange,
}: {
  settings: OrderSettings;
  onChange: (settings: OrderSettings) => void;
  showBelowThreshold: boolean;
  onShowBelowThresholdChange: (show: boolean) => void;
}) {
  return (
    <section className="settings" aria-label="Порог закупки">
      <label>
        Минимальная сумма закупки, ₽
        <Input
          type="number"
          min="0"
          step="100"
          value={settings.minimumOrderAmount}
          onChange={(event) =>
            onChange({
              ...settings,
              minimumOrderAmount: Math.max(0, Number(event.target.value) || 0),
            })
          }
        />
      </label>

      <label>
        Порог считать
        <Select
          value={settings.thresholdMode}
          onChange={(event) =>
            onChange({
              ...settings,
              thresholdMode: event.target.value as ThresholdMode,
            })
          }
        >
          <option value="SUPPLIER_TOTAL">По поставщику в целом</option>
          <option value="BRANCH_SUPPLIER">По заказу подразделение → поставщик</option>
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
