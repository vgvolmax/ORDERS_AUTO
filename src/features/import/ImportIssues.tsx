import { useMemo, useState } from 'react';
import type { ValidationIssue } from '../../domain/types';
import { SearchInput, Select } from '../../components/ui';
import { VirtualTable } from '../../components/VirtualTable';

/** Complete diagnostics stay searchable even when their rows are virtualized. */
export function ImportIssues({
  title,
  issues,
}: {
  title: string;
  issues: ValidationIssue[];
}) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<'ALL' | ValidationIssue['severity']>(
    'ALL',
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const rows = useMemo(
    () =>
      issues
        .map((issue, index) => ({ issue, index }))
        .filter(
          ({ issue }) =>
            (severity === 'ALL' || issue.severity === severity) &&
            [issue.message, issue.skuCode, issue.branch, issue.row, issue.code]
              .join(' ')
              .toLocaleLowerCase('ru-RU')
              .includes(normalizedQuery),
        ),
    [issues, severity, normalizedQuery],
  );
  const errors = issues.filter((issue) => issue.severity === 'ERROR').length;

  return (
    <section className="issue-list" aria-label={`Сообщения проверки: ${title}`}>
      <strong>
        Проверка данных: {issues.length} · Ошибок: {errors} · Предупреждений:{' '}
        {issues.length - errors}
      </strong>
      <div className="import-issue-filters">
        <label>
          Поиск сообщений
          <SearchInput
            aria-label={`Поиск сообщений: ${title}`}
            value={query}
            onValueChange={setQuery}
            placeholder="Код, подразделение, строка или текст"
          />
        </label>
        <label>
          Важность
          <Select
            aria-label={`Важность сообщений: ${title}`}
            value={severity}
            onChange={(event) =>
              setSeverity(event.target.value as typeof severity)
            }
          >
            <option value="ALL">Все сообщения</option>
            <option value="ERROR">Ошибки ({errors})</option>
            <option value="WARNING">Предупреждения ({issues.length - errors})</option>
          </Select>
        </label>
      </div>
      <p className="import-issue-count" role="status">
        Показано: {rows.length} из {issues.length}
      </p>
      <VirtualTable
        key={`${severity}:${normalizedQuery}`}
        rows={rows}
        getRowKey={(row) => String(row.index)}
        maxHeight="320px"
        estimateRowHeight={100}
        emptyMessage="Нет сообщений по выбранным фильтрам."
        columns={[
          {
            key: 'source',
            header: 'Источник',
            width: '150px',
            render: ({ issue }) => (
              <>
                {issue.row != null && (
                  <small>Строка <span>{issue.row}</span></small>
                )}
                {issue.skuCode && <strong>{issue.skuCode}</strong>}
                {issue.branch && <small>{issue.branch}</small>}
                {issue.row == null && !issue.skuCode && !issue.branch && 'Весь отчёт'}
              </>
            ),
          },
          {
            key: 'message',
            header: 'Сообщение',
            width: 'minmax(220px, 1fr)',
            render: ({ issue }) => (
              <>
                <strong
                  className={issue.severity === 'ERROR' ? 'danger-text' : 'warning-text'}
                >
                  {issue.severity === 'ERROR' ? 'Ошибка' : 'Предупреждение'}
                </strong>
                <span>{issue.message}</span>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
