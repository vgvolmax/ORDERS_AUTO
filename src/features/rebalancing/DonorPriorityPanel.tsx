import { useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import type { DonorPlanCommand } from '../../app/rebalanceActions';
import type { DonorPriorityLevels } from '../../domain/rebalancing';
import type { DonorPrioritySummary } from './donorPrioritySummary';
import type { DonorRecipient } from './DonorAllocationCard';
import { money } from '../demand/DemandPage';

type Rank = 0 | 1 | 2;
export function DonorPriorityPanel({
  summary,
  recipients,
  fromBranchId,
  disabled,
  accepting,
  onEdit,
  onScope,
  onAccept,
}: {
  summary: DonorPrioritySummary;
  recipients: DonorRecipient[];
  fromBranchId: string;
  disabled: boolean;
  accepting: boolean;
  onEdit: (command: DonorPlanCommand) => Promise<void>;
  onScope: (priority: Rank) => void;
  onAccept: (priority: Rank) => void;
}) {
  const [editor, setEditor] = useState<Rank | null>(null),
    [draft, setDraft] = useState<DonorPriorityLevels>([[], [], []]),
    [overwrite, setOverwrite] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [compact, setCompact] = useState(() => window.innerHeight < 740),
    ref = useRef<HTMLDivElement>(null),
    restore = useRef<Rank | null>(null);
  const names = new Map(recipients.map((r) => [r.id, r.name]));
  useLayoutEffect(() => {
    if (!pending && !disabled && restore.current !== null) {
      ref.current
        ?.querySelector<HTMLButtonElement>(
          `[data-priority-editor="${restore.current}"]`,
        )
        ?.focus();
      restore.current = null;
    }
  }, [pending, disabled]);
  const open = (rank: Rank) => {
    setDraft(structuredClone(summary.levels));
    setOverwrite(false);
    setError('');
    setEditor(rank);
  };
  async function apply(levels: DonorPriorityLevels, overwriteManual = false) {
    if (pending || disabled) return;
    setPending(true);
    setError('');
    try {
      await onEdit({ kind: 'levels', fromBranchId, levels, overwriteManual });
      setEditor(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Не удалось сохранить приоритеты. Повторите попытку.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      ref={ref}
      className={`donor-priority-panel ${compact ? 'is-compact' : ''}`}
      aria-busy={pending}
    >
      <div className="donor-priority-caption">
        <strong>
          Прогноз с предложенными перемещениями · покрытие без отклонённых
        </strong>
        <button className="link" onClick={() => setCompact((v) => !v)}>
          {compact ? 'Показать подразделения' : 'Свернуть подразделения'}
        </button>
      </div>
      <div className="donor-priority-grid">
        {([0, 1, 2] as const).map((rank) => {
          const group = summary.groups[rank],
            level = summary.levels[rank];
          return (
            <section
              className="donor-priority-tier"
              key={rank}
              aria-label={`Приоритет ${rank + 1}`}
            >
              <div className="donor-priority-title">
                <h3>Приоритет {rank + 1}</h3>
                <Button
                  className="secondary"
                  data-priority-editor={rank}
                  aria-label={`Настроить приоритет ${rank + 1}`}
                  disabled={disabled || pending}
                  onClick={() => open(rank)}
                >
                  Подразделения · {level.length}
                </Button>
              </div>
              {!compact && (
                <div className="donor-priority-members">
                  {level.length ? (
                    level.slice(0, 2).map((id) => (
                      <span key={id} className="donor-priority-chip">
                        {names.get(id) ?? id}
                        <button
                          aria-label={`Убрать ${names.get(id) ?? id} из приоритета ${rank + 1}`}
                          disabled={disabled || pending}
                          onClick={() => {
                            restore.current = rank;
                            void apply(
                              summary.levels.map((items, i) =>
                                i === rank
                                  ? items.filter((v) => v !== id)
                                  : [...items],
                              ) as DonorPriorityLevels,
                            );
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="muted">
                      Не выбраны · очередь пропускается
                    </span>
                  )}
                  {level.length > 2 && (
                    <button
                      className="link"
                      disabled={disabled || pending}
                      onClick={() => open(rank)}
                    >
                      Ещё {level.length - 2}
                    </button>
                  )}
                </div>
              )}
              <div className="donor-priority-money">
                <span>
                  Всего{' '}
                  <strong>
                    {group.totalAmount === null
                      ? '—'
                      : money(group.totalAmount)}
                  </strong>
                </span>
                <span>
                  Принято{' '}
                  <strong>
                    {group.acceptedAmount === null
                      ? '—'
                      : money(group.acceptedAmount)}
                  </strong>
                </span>
              </div>
              <div className="donor-priority-coverage">
                <span>
                  До Max: <strong>{group.fullSkuCount} SKU</strong>
                </span>
                <span>
                  Неполно: <strong>{group.partialSkuCount} SKU</strong>
                </span>
                {group.missingPriceLineCount > 0 && (
                  <span>Без цены: {group.missingPriceLineCount}</span>
                )}
              </div>
              <div className="donor-priority-actions">
                <Button
                  className="secondary"
                  onClick={() => onScope(rank)}
                  disabled={!(group.fullSkuCount + group.partialSkuCount)}
                >
                  Показать SKU
                </Button>
                <Button
                  disabled={accepting || !group.sourceLineIds.length}
                  onClick={() => onAccept(rank)}
                >
                  Принять приоритет {rank + 1} ({group.sourceLineIds.length})
                </Button>
              </div>
            </section>
          );
        })}
      </div>
      <p className="donor-priority-note">
        1 → 2 → 3 → остальные. По всему плану донора, независимо от фильтров.
        Вручную: {summary.manualCount}; индивидуальные:{' '}
        {summary.individualCount}.
      </p>
      {error && editor === null && (
        <Alert tone="danger">
          {error} Откройте настройку и повторите применение.
        </Alert>
      )}
      {editor !== null && (
        <Dialog
          title={`Подразделения приоритета ${editor + 1}`}
          onClose={() => {
            if (!pending) setEditor(null);
          }}
          actions={
            <>
              <Button
                className="secondary"
                disabled={pending}
                onClick={() => setEditor(null)}
              >
                Отмена
              </Button>
              <Button
                disabled={pending || disabled}
                onClick={() => void apply(draft, overwrite)}
              >
                {pending ? 'Сохранение…' : 'Применить'}
              </Button>
            </>
          }
        >
          <p>
            Применить ко всем SKU донора. Индивидуальные флажки заменятся; общая
            раскладка затронутых товаров может измениться. Принятые количества
            сохраняются.
          </p>
          <div className="donor-priority-choices">
            {recipients.map((r) => {
              const other = draft.findIndex((items) => items.includes(r.id));
              return (
                <label key={r.id} className="checkbox-control">
                  <input
                    type="checkbox"
                    aria-label={r.name}
                    checked={draft[editor].includes(r.id)}
                    disabled={pending}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setDraft(
                        (current) =>
                          current.map((items, i) =>
                            i === editor
                              ? checked
                                ? [...items.filter((id) => id !== r.id), r.id]
                                : items.filter((id) => id !== r.id)
                              : checked
                                ? items.filter((id) => id !== r.id)
                                : items,
                          ) as DonorPriorityLevels,
                      );
                    }}
                  />
                  <span>
                    {r.name}
                    {other >= 0 && other !== editor && (
                      <small>
                        {' '}
                        · сейчас приоритет {other + 1}; будет перенесено
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={pending}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Перезаписать ручные количества ({summary.manualCount} SKU)
          </label>
          <p className="muted">
            Без флажка ручные строки сохраняются. Удалённые подразделения
            получают остаток после всех приоритетов.
          </p>
          {error && <Alert tone="danger">{error} Повторите применение.</Alert>}
        </Dialog>
      )}
    </div>
  );
}
