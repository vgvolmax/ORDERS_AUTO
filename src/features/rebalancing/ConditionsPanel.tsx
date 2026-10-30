import { useState } from 'react';
import { Button, Input, SearchInput, Select, Alert } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';
import { QuantityInput } from '../../components/QuantityInput';
import type {
  RebalanceConfig,
  SkuQuantityPolicy,
} from '../../domain/rebalancing';
export function ConditionsPanel({
  config,
  onChange,
  skus,
  policies,
  onPolicies,
  locked,
}: {
  config: RebalanceConfig;
  onChange: (c: RebalanceConfig) => void | Promise<void>;
  skus: { code: string; name: string }[];
  policies: SkuQuantityPolicy[];
  onPolicies: (p: SkuQuantityPolicy[]) => void;
  locked: boolean;
}) {
  const [query, setQuery] = useState(''),
    [unit, setUnit] = useState(''),
    [step, setStep] = useState(''),
    [error, setError] = useState('');
  const policyByCode = new Map(policies.map((p) => [p.skuCode, p]));
  const missing = skus.filter((s) => !policyByCode.has(s.code));
  const valid = (u: string, n: number) =>
    Boolean(u.trim()) && Number.isFinite(n) && n > 0;
  function policy(code: string, u: string, n: number) {
    if (!valid(u, n)) {
      setError('Укажите единицу и положительный шаг.');
      return;
    }
    setError('');
    onPolicies([
      ...policies.filter((p) => p.skuCode !== code),
      { skuCode: code, unit: u.trim(), quantityStep: n },
    ]);
  }
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
      <section className="panel quantity-policies">
        <h2>Единицы и шаг перемещения</h2>
        <p>
          Без явной единицы и шага SKU исключается из расчёта. Не настроено:{' '}
          {missing.length}.
        </p>
        {locked && (
          <Alert tone="warning">
            Для изменения единиц сначала отмените принятые перемещения. Их
            количество привязано к текущему снимку.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="filters">
          <label>
            Единица для ненастроенных SKU
            <Input
              aria-label="Единица для ненастроенных SKU"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              disabled={locked}
              placeholder="Например, шт"
            />
          </label>
          <label>
            Шаг для ненастроенных SKU
            <Input
              aria-label="Шаг для ненастроенных SKU"
              type="number"
              min="0"
              step="any"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              disabled={locked}
            />
          </label>
          <Button
            className="secondary"
            disabled={locked || !missing.length || !valid(unit, Number(step))}
            onClick={() =>
              onPolicies([
                ...policies,
                ...missing.map((s) => ({
                  skuCode: s.code,
                  unit: unit.trim(),
                  quantityStep: Number(step),
                })),
              ])
            }
          >
            Назначить ненастроенным ({missing.length})
          </Button>
          <label>
            Найти SKU
            <SearchInput value={query} onValueChange={setQuery} />
          </label>
        </div>
        <VirtualTable
          rows={skus.filter((s) =>
            `${s.code} ${s.name}`
              .toLocaleLowerCase('ru')
              .includes(query.toLocaleLowerCase('ru')),
          )}
          getRowKey={(s) => s.code}
          columns={[
            {
              key: 'sku',
              header: 'Код · товар',
              width: 'minmax(240px, 1fr)',
              render: (s) => (
                <>
                  {s.code} · {s.name}
                </>
              ),
            },
            {
              key: 'policy',
              header: 'Единица · шаг',
              width: '420px',
              render: (s) => (
                <PolicyEditor
                  key={`${s.code}:${policyByCode.get(s.code)?.unit}:${
                    policyByCode.get(s.code)?.quantityStep
                  }`}
                  code={s.code}
                  value={policyByCode.get(s.code)}
                  locked={locked}
                  onSave={(u, n) => policy(s.code, u, n)}
                />
              ),
            },
          ]}
        />
      </section>
    </>
  );
}

function PolicyEditor({
  code,
  value,
  locked,
  onSave,
}: {
  code: string;
  value: SkuQuantityPolicy | undefined;
  locked: boolean;
  onSave: (unit: string, step: number) => void;
}) {
  const [unit, setUnit] = useState(value?.unit ?? ''),
    [step, setStep] = useState(value ? String(value.quantityStep) : '');
  return (
    <form
      noValidate
      className="policy-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(unit, Number(step));
      }}
    >
      <Input
        aria-label={`Единица ${code}`}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        disabled={locked}
      />
      <Input
        aria-label={`Шаг ${code}`}
        type="number"
        min="0"
        step="any"
        value={step}
        onChange={(e) => setStep(e.target.value)}
        disabled={locked}
      />
      <Button
        className="secondary"
        disabled={
          locked ||
          !unit.trim() ||
          !step ||
          !Number.isFinite(Number(step)) ||
          Number(step) <= 0
        }
      >
        Сохранить
      </Button>
    </form>
  );
}
