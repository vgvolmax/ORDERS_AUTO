import { useDurableDraft } from '../../app/useDurableDraft';
import type { DonorPlanCommand } from '../../app/rebalanceActions';
import { QuantityInput } from '../../components/QuantityInput';
import type { DonorAllocationRow } from '../../domain/rebalancing/allocationPlan';
import { fmtQty } from '../demand/DemandPage';

export interface DonorRecipient {
  id: string;
  name: string;
}
export function DonorAllocationCard({
  row: r,
  recipients,
  disabled,
  stale,
  onEdit,
  onProduct,
}: {
  row: DonorAllocationRow;
  recipients: DonorRecipient[];
  disabled: boolean;
  stale: boolean;
  onEdit: (command: DonorPlanCommand) => Promise<void>;
  onProduct: () => void;
}) {
  const cells = new Map(r.cells.map((c) => [c.toBranchId, c]));
  return (
    <article
      className={`donor-allocation-card ${r.priorityRequired ? 'needs-priorities' : ''}`}
      aria-label={`Перемещения ${r.skuCode}`}
    >
      <div className="donor-allocation-card-head">
        <div className="donor-card-product">
          <div>
            <strong>{r.skuCode}</strong>
            <span className="donor-status">
              {r.priorityRequired
                ? 'Нужны приоритеты'
                : r.decisionMode === 'MANUAL'
                  ? 'Вручную'
                  : r.decisionMode === 'PRIORITY'
                    ? 'Приоритеты заданы'
                    : 'Автоматически'}
            </span>
            <small>
              {r.unit} · шаг {fmtQty(r.step)}
            </small>
          </div>
          <button
            className="transfer-product-name"
            aria-label={`Показать товар ${r.skuCode}`}
            onClick={onProduct}
          >
            {r.name}
          </button>
        </div>
        <div className="donor-card-budget">
          <strong>
            Доступно {fmtQty(r.availableQty)} · План {fmtQty(r.plannedQty)} ·
            После {fmtQty(r.after)}
          </strong>
          <small>
            По отчёту {fmtQty(r.stock)} · MAX {fmtQty(r.max)} · Принято{' '}
            {fmtQty(r.acceptedOutgoing)}
          </small>
        </div>
      </div>
      <div className="donor-recipient-grid">
        {recipients.map((recipient) => {
          const c = cells.get(recipient.id);
          return (
            <section
              className={`donor-recipient-card ${!c ? 'is-unavailable' : c.priority ? 'is-priority' : ''}`}
              key={recipient.id}
              role="group"
              aria-label={`Получатель ${recipient.name}`}
            >
              <h3>{recipient.name}</h3>
              {!c ? (
                <span className="muted">Нет потребности или маршрута</span>
              ) : (
                <>
                  <strong className="donor-card-need">
                    Нужно{c.target !== c.max ? ' до цели' : ''}:{' '}
                    {fmtQty(c.need)}
                    {c.target !== c.max
                      ? ` · до MAX ${fmtQty(c.needToMax)}`
                      : ''}
                  </strong>
                  <small>
                    Ост. {fmtQty(c.stock)} · MIN {fmtQty(c.min)} · MAX{' '}
                    {fmtQty(c.max)}
                    {c.target !== c.max ? ` · цель ${fmtQty(c.target)}` : ''}
                  </small>
                  {c.locked ? (
                    <strong className="success donor-card-accepted">
                      Принято: {fmtQty(c.acceptedQty)} {r.unit} · зафиксировано
                    </strong>
                  ) : (
                    <div className="donor-card-inputs">
                      <label className="checkbox-control">
                        <PriorityFlag
                          label={`Приоритет ${r.skuCode} ${recipient.name}`}
                          value={c.priority}
                          disabled={disabled || !c.canAllocate}
                          onCommit={(checked) =>
                            onEdit({
                              kind: 'priorities',
                              skuCode: r.skuCode,
                              fromBranchId: r.fromBranchId,
                              recipientIds: r.cells
                                .filter((v) =>
                                  v.toBranchId === recipient.id
                                    ? checked
                                    : v.priority,
                                )
                                .map((v) => v.toBranchId),
                            })
                          }
                        />
                        Приоритет
                      </label>
                      <label>
                        Переместить
                        <QuantityInput
                          aria-label={`Переместить ${r.skuCode} ${recipient.name}`}
                          value={c.qty}
                          step={r.step}
                          disabled={stale || !c.canAllocate}
                          onCommit={(qty) =>
                            onEdit({
                              kind: 'quantity',
                              skuCode: r.skuCode,
                              fromBranchId: r.fromBranchId,
                              toBranchId: recipient.id,
                              qty,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                  {(c.acceptedIncoming > 0 || c.otherPlanned > 0) && (
                    <small>
                      Принятый вход {fmtQty(c.acceptedIncoming)} · План других{' '}
                      {fmtQty(c.otherPlanned)}
                      {c.otherPlannedRejected > 0
                        ? ` (отклонено ${fmtQty(c.otherPlannedRejected)})`
                        : ''}
                    </small>
                  )}
                  {c.rejectedQty > 0 && (
                    <small className="warning-text">
                      Отклонено {fmtQty(c.rejectedQty)} {r.unit}
                    </small>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}
function PriorityFlag({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onCommit: (checked: boolean) => Promise<void>;
}) {
  const [checked, change] = useDurableDraft(value, label, onCommit);
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => change(e.target.checked)}
    />
  );
}
