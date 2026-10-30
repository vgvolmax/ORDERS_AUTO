import { Input, Select } from '../../components/ui';
import { QuantityInput } from '../../components/QuantityInput';
import type { RebalanceConfig } from '../../domain/rebalancing';

export function ConditionsPanel({
  config,
  onChange,
}: {
  config: RebalanceConfig;
  onChange: (config: RebalanceConfig) => void | Promise<void>;
}) {
  return (
    <>
      <section className="panel">
        <h2>Условия перемещений</h2>
        <p>
          Денежные фильтры используют справочную цену MIN/MAX. Позиции с
          неизвестной ценой попадут в исключения при включённых денежных
          фильтрах.
        </p>
        <div className="rebalance-fields">
          <label>
            Получатель
            <Select
              aria-label="Получатель"
              value={config.recipientTrigger}
              onChange={(e) =>
                onChange({
                  ...config,
                  recipientTrigger: e.target
                    .value as RebalanceConfig['recipientTrigger'],
                })
              }
            >
              <option value="BELOW_MIN">Остаток строго ниже Min</option>
              <option value="BELOW_MAX">Остаток ниже Max</option>
            </Select>
          </label>
          <label>
            Цель получателя: {config.receiverPct}% от Min до Max
            <Input
              aria-label="Цель получателя"
              type="range"
              step={5}
              min="0"
              max="100"
              value={config.receiverPct}
              onChange={(e) =>
                onChange({ ...config, receiverPct: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p>
          Донор отдаёт только физический излишек сверх Max. Принятый вход не
          становится источником для нового перемещения.
        </p>
        <div className="rebalance-fields">
          {(['unitPriceFilter', 'skuAmountFilter'] as const).map((key) => (
            <div key={key}>
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={config[key].enabled}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      [key]: { ...config[key], enabled: e.target.checked },
                    })
                  }
                />
                {key === 'unitPriceFilter'
                  ? 'Цена единицы строго выше порога'
                  : 'Сумма перемещений SKU строго выше порога'}
              </label>
              <label>
                Порог, ₽
                <QuantityInput
                  aria-label={
                    key === 'unitPriceFilter' ? 'Порог цены' : 'Порог суммы SKU'
                  }
                  value={config[key].threshold}
                  onCommit={(threshold) =>
                    onChange({
                      ...config,
                      [key]: { ...config[key], threshold },
                    })
                  }
                  saveErrorMessage="Порог не сохранён. Повторите ввод."
                  invalidValueMessage="Введите неотрицательный порог."
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
