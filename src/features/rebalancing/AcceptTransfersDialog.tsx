import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import type { PurchaseDemandLine } from '../../domain/purchaseDemand';
import { fmtQty } from '../demand/DemandPage';
export function AcceptTransfersDialog({
  kind,
  count,
  before,
  after,
  clearedEdits,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  kind: 'accept' | 'revoke';
  count: number;
  before: PurchaseDemandLine[];
  after: PurchaseDemandLine[];
  clearedEdits: number;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const changes = after.filter((n) =>
    before.some(
      (p) =>
        p.skuCode === n.skuCode &&
        p.branch === n.branch &&
        p.purchaseQty !== n.purchaseQty,
    ),
  );
  return (
    <Dialog
      title={
        kind === 'accept'
          ? 'Принять выбранные перемещения'
          : 'Отменить принятие перемещения'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      actions={
        <>
          <Button className="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy
              ? 'Сохранение…'
              : kind === 'accept'
              ? 'Принять перемещения'
              : 'Отменить принятие'}
          </Button>
        </>
      }
    >
      <p>Строк: {count}. Изменение текущей закупки:</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th>Подразделение</th>
              <th>Было → станет</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((l) => (
              <tr key={`${l.skuCode}\0${l.branch}`}>
                <td>{l.skuCode}</td>
                <td>{l.branch}</td>
                <td>
                  {fmtQty(
                    before.find(
                      (p) => p.skuCode === l.skuCode && p.branch === l.branch,
                    )!.purchaseQty,
                  )}{' '}
                  → {fmtQty(l.purchaseQty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clearedEdits > 0 && (
        <Alert tone="warning">
          Будут сброшены ручные количества в изменившихся строках:{' '}
          {clearedEdits}. Остальные ручные количества сохраняются.
        </Alert>
      )}
      <p>Для изменившихся заказов будут сняты отметки проверки и выгрузки.</p>
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
