import { productColumns } from '../../components/productColumns';
import { useMemo } from 'react';
import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';
import type { PurchaseDemandLine } from '../../domain/purchaseDemand';
import { money } from '../demand/DemandPage';
export interface AcceptanceScopeSummary {
  donor: string;
  recipients: string[];
  skuCount: number;
  amount: number | null;
  missingPriceLineCount: number;
}
import { fmtQty } from '../demand/DemandPage';
export function AcceptTransfersDialog({
  kind,
  count,
  scopeSummary,
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
  scopeSummary?: AcceptanceScopeSummary | undefined;
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
      {scopeSummary && (
        <p>
          Донор: {scopeSummary.donor}. Получатели:{' '}
          {scopeSummary.recipients.join(', ')}. SKU: {scopeSummary.skuCount}.
          Сумма:{' '}
          {scopeSummary.amount === null ? '—' : money(scopeSummary.amount)}.
          {scopeSummary.missingPriceLineCount > 0 &&
            ` Без цены: ${scopeSummary.missingPriceLineCount}.`}
        </p>
      )}
      <p>Строк: {count}. Изменение текущей закупки:</p>
      <p>Изменённых строк закупки: {changes.length}.</p>
      <VirtualTable
        rows={changes}
        getRowKey={({ line }) => JSON.stringify([line.skuCode, line.branch])}
        emptyMessage="Расчётное количество закупки не меняется."
        columns={[
          ...productColumns<(typeof changes)[number]>(({ line }) => ({
            code: line.skuCode,
            article: line.article,
            name: line.name,
          })),
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
