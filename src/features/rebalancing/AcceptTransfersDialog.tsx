import { useMemo } from 'react';
import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';
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
  const changes = useMemo(() => {
    const key = (line: PurchaseDemandLine) =>
      JSON.stringify([line.skuCode, line.branch]);
    const previous = new Map(
      before.map((line) => [key(line), line.purchaseQty]),
    );
    const rows: { line: PurchaseDemandLine; previousQty: number }[] = [];
    for (const line of after) {
      const previousQty = previous.get(key(line));
      if (previousQty !== undefined && previousQty !== line.purchaseQty)
        rows.push({ line, previousQty });
    }
    return rows;
  }, [before, after]);
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
      <p>Изменённых строк закупки: {changes.length}.</p>
      <VirtualTable
        rows={changes}
        getRowKey={({ line }) => JSON.stringify([line.skuCode, line.branch])}
        emptyMessage="Расчётное количество закупки не меняется."
        columns={[
          {
            key: 'sku',
            header: 'Код',
            width: '140px',
            render: ({ line }) => line.skuCode,
          },
          {
            key: 'branch',
            header: 'Подразделение',
            width: 'minmax(180px, 1fr)',
            render: ({ line }) => line.branch,
          },
          {
            key: 'quantity',
            header: 'Было → станет',
            width: '160px',
            render: ({ line, previousQty }) => (
              <>
                {fmtQty(previousQty)} → {fmtQty(line.purchaseQty)}
              </>
            ),
          },
        ]}
      />
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
