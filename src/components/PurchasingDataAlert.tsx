import type { ValidationIssue } from '../domain/types';
import { useStore } from '../app/appStore';
import { Alert, Button } from './ui';
import { VirtualTable } from './VirtualTable';

/** The same unfiltered source problems remain visible across purchasing screens. */
export function PurchasingDataAlert({
  issues = [],
}: {
  issues?: ValidationIssue[] | undefined;
}) {
  const { set } = useStore();
  if (!issues.length) return null;
  return (
    <Alert tone="danger">
      <strong>Расчёт неполный: есть ошибки в MIN/MAX</strong>
      <p>
        Неоднозначные строки блокируют соответствующие заказы. Потребность по
        повреждённым строкам неизвестна. Остальные заказы доступны для работы.
      </p>
      <details>
        <summary>Показать ошибки MIN/MAX ({issues.length})</summary>
        <VirtualTable
          rows={issues}
          maxHeight="280px"
          getRowKey={(issue) =>
            JSON.stringify([issue.code, issue.skuCode, issue.branch, issue.row])
          }
          columns={[
            {
              key: 'code',
              header: 'Код',
              width: '120px',
              render: (issue) => issue.skuCode ?? '—',
            },
            {
              key: 'branch',
              header: 'Подразделение',
              width: '170px',
              render: (issue) => issue.branch ?? 'Весь товар',
            },
            {
              key: 'message',
              header: 'Проблема',
              width: 'minmax(300px, 1fr)',
              render: (issue) => issue.message,
            },
          ]}
        />
      </details>
      <Button className="secondary" onClick={() => set({ page: 'import' })}>
        Проверить MIN/MAX
      </Button>
    </Alert>
  );
}
