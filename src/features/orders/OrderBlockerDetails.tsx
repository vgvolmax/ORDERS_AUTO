import type { WorkflowOrder } from '../../app/selectors';
import type { ValidationIssue } from '../../domain/types';
import { normalizeKey } from '../../domain/normalize';
import { VirtualTable } from '../../components/VirtualTable';

/** Explains existing export blockers; does not decide whether an order is exportable. */
export function OrderBlockerDetails({ order, dataIssues = [] }: {
  order: WorkflowOrder;
  dataIssues?: ValidationIssue[] | undefined;
}) {
  const sourceBlockers = order.blockers.filter(blocker => blocker.startsWith('Ошибка данных MIN/MAX:'));
  const missingPrices = order.lines.filter(line => line.orderQty > 0 && line.unitPrice == null);
  return <div className="order-blocker-details">
    {order.blockers.filter(blocker => !sourceBlockers.includes(blocker)).map(blocker => (
      <div key={blocker}>
        <strong>{blocker}</strong>
        <p>{blocker === 'Не хватает цены'
          ? 'Добавьте цену в отчёт MIN/MAX и загрузите обновлённый отчёт.'
          : blocker === 'Нет позиций с количеством больше нуля'
            ? 'Восстановите исключённую позицию или укажите количество больше нуля. Пустой заказ выгружать не нужно.'
            : blocker === 'Ниже минимальной суммы'
              ? 'Увеличьте заказ или проверьте минимальную сумму закупки в разделе «Заказы».'
              : 'Проверьте указанные данные заказа перед выгрузкой.'}</p>
      </div>
    ))}
    {order.blockers.includes('Не хватает цены') && missingPrices.length > 0 && <VirtualTable
      rows={missingPrices}
      getRowKey={line => line.skuCode}
      maxHeight="240px"
      columns={[{ key: 'product', header: 'Товары без цены', width: 'minmax(280px, 1fr)', render: line => `${line.skuCode} · ${line.article ?? '—'} · ${line.name}` }]}
    />}
    {sourceBlockers.length > 0 && <>
      <p>Исправьте указанные строки в исходном MIN/MAX и загрузите обновлённый отчёт.</p>
      <VirtualTable
        rows={sourceBlockers.map(blocker => {
          const line = order.lines.find(line => blocker === `Ошибка данных MIN/MAX: ${line.skuCode} / ${order.branch}`);
          const issues = dataIssues.filter(issue => issue.severity === 'ERROR' && issue.skuCode === line?.skuCode &&
            (!issue.branch || normalizeKey(issue.branch) === normalizeKey(order.branch)));
          return { blocker, details: issues.map(issue => `${issue.message}${issue.row != null ? ` (строка ${issue.row})` : ''}`).join('; ') };
        })}
        getRowKey={row => row.blocker}
        maxHeight="240px"
        columns={[{ key: 'problem', header: 'Ошибки исходных данных', width: 'minmax(280px, 1fr)', render: row => <><strong>{row.blocker}</strong>{row.details && <p>{row.details}</p>}</> }]}
      />
    </>}
  </div>;
}
