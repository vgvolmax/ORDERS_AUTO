import { getTransferAmountFilter } from '../../domain/rebalancing';
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
  const filter = getTransferAmountFilter(config);
  return (
    <>
      <section className="panel">
        <h2>Условия перемещений</h2>
        <p>
          Сумма перемещения SKU рассчитывается по справочной цене MIN/MAX. При
          включённом фильтре позиции с неизвестной ценой попадут в исключения.
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
        <p className="condition-target-help">
          Цель получателя: 0% — довести до MIN, 50% — до середины между MIN и
          MAX, 100% — до MAX.
        </p>
        <p>
          Донор отдаёт только физический излишек сверх Max. Принятый вход не
          становится источником для нового перемещения.
        </p>
        <div className="rebalance-fields">
          <div>
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={filter.enabled}
                onChange={(e) =>
                  onChange({
                    ...config,
                    transferAmountFilter: {
                      ...filter,
                      enabled: e.target.checked,
                    },
                  })
                }
              />
              Минимальная сумма SKU в перемещении
            </label>
            <label>
              Порог, ₽
              <QuantityInput
                aria-label="Порог суммы SKU"
                value={filter.threshold}
                onCommit={(threshold) =>
                  onChange({
                    ...config,
                    transferAmountFilter: { ...filter, threshold },
                  })
                }
                saveErrorMessage="Порог не сохранён. Повторите ввод."
                invalidValueMessage="Введите неотрицательный порог."
              />
            </label>
          </div>
        </div>
        <p>
          Количество одного SKU × цена MIN/MAX проверяется отдельно для каждого
          направления «донор → получатель». Сумма должна быть не ниже порога;
          равенство допускается. Разные SKU, доноры и получатели не
          складываются. Строки ниже порога исключаются, остальные сохраняются.
          После принятия недостающий до MAX остаток остаётся в потребности на
          закупку.
        </p>
      </section>
    </>
  );
}
