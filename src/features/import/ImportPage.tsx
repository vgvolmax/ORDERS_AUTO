import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { calculateDemand } from '../../domain/demand';
import { resolveSuppliers } from '../../domain/suppliers';
import { isSupplierInPool } from '../../domain/supplierPool';
import type { ValidationIssue } from '../../domain/types';
import { parseMinMaxWorkbook } from '../../import/minMaxParser';
import { parseSupplierWorkbook } from '../../import/supplierParser';
import { Alert, Button } from '../../components/ui';

export function ImportPage() {
  const { state, set, commit } = useStore();
  const reads = useRef({ min: 0, sup: 0 });
  const [failures, setFailures] = useState({ min: '', sup: '' });
  const anyLoading = state.minMaxLoading || state.supplierLoading;
  const supplierPoolCount =
    state.suppliers?.suppliers.filter(isSupplierInPool).length ?? 0;

  const supplierResolutionSummary = useMemo(() => {
    if (!state.minMax || !state.suppliers) {
      return null;
    }

    const neededSkuCodes = new Set(
      calculateDemand(state.minMax)
        .filter((line) => line.deficitQty > 0)
        .map((line) => line.skuCode),
    );
    const resolutions = resolveSuppliers(
      state.suppliers.history.filter((row) => isSupplierInPool(row.supplier)),
      state.overrides,
      [...neededSkuCodes],
    ).filter((resolution) => neededSkuCodes.has(resolution.skuCode));

    return {
      multiple: resolutions.filter((item) => item.status === 'MANUAL_REQUIRED')
        .length,
      withoutSupplier: resolutions.filter(
        (item) => item.status === 'UNRESOLVED',
      ).length,
      stale: resolutions.filter((item) => item.status === 'STALE_OVERRIDE')
        .length,
    };
  }, [state.minMax, state.suppliers, state.overrides]);

  async function load(file: File, kind: 'min' | 'sup') {
    const token = ++reads.current[kind],
      epoch = state.importEpoch;
    set(kind === 'min' ? { minMaxLoading: true } : { supplierLoading: true });
    setFailures((previous) => ({ ...previous, [kind]: '' }));
    try {
      const bytes = await file.arrayBuffer();
      if (reads.current[kind] !== token) return;
      const result =
        kind === 'min'
          ? parseMinMaxWorkbook(
              bytes,
              state.rebalance.registry.flatMap((branch) => [
                branch.name,
                ...branch.aliases,
              ]),
            )
          : parseSupplierWorkbook(bytes);
      if (result.fatal || !result.data) {
        setFailures((previous) => ({
          ...previous,
          [kind]:
            result.issues.map((i) => i.message).join(' ') ||
            'Файл не принят. Проверьте формат отчёта.',
        }));
        return;
      }
      const ref = {
        fileId: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      };
      const update = (current: typeof state) =>
        reads.current[kind] !== token || current.importEpoch !== epoch
          ? {}
          : {
              ...(kind === 'min'
                ? {
                    minMax: result.data as NonNullable<typeof state.minMax>,
                    minMaxFileName: file.name,
                    minMaxIssues: result.issues,
                  }
                : {
                    suppliers: result.data as NonNullable<
                      typeof state.suppliers
                    >,
                    supplierFileName: file.name,
                    supplierIssues: result.issues,
                  }),
              rawImports: {
                ...current.rawImports,
                [kind === 'min' ? 'minMax' : 'suppliers']: ref,
              },
              pendingFiles: [{ ...ref, bytes }],
              reviewedOrderIds: [],
              exportedOrderIds: [],
              toast: 'Отчёт успешно распознан и сохранён.',
            };
      if (commit) await commit(update);
      else set(update);
    } catch {
      if (reads.current[kind] === token)
        setFailures((previous) => ({
          ...previous,
          [kind]:
            'Не удалось прочитать или сохранить файл. Предыдущий отчёт сохранён. Повторите выбор файла.',
        }));
    } finally {
      if (reads.current[kind] === token)
        set(
          kind === 'min'
            ? { minMaxLoading: false }
            : { supplierLoading: false },
        );
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Рабочий сеанс</p>
        <h1>Импорт отчётов 1С</h1>
        <p>
          Загрузите два отчёта. Они обрабатываются только в браузере и никуда не
          отправляются.
        </p>
      </header>
      <details className="import-help">
        <summary>Какие отчёты загрузить</summary>
        <p>
          MIN/MAX — отчёт с кодом, артикулом, наименованием, остатками и
          нормативами по подразделениям. Поставщики — история закупок с кодом
          товара, контрагентом, количеством и стоимостью. Товары сопоставляются
          по полному коду 1С.
        </p>
      </details>

      {anyLoading && <Alert>Обработка отчёта…</Alert>}
      {failures.min && <Alert tone="danger">MIN/MAX: {failures.min}</Alert>}
      {failures.sup && <Alert tone="danger">Поставщики: {failures.sup}</Alert>}
      {(state.minMax || state.suppliers) && (
        <p>
          Замена отчёта создаёт новый сеанс без принятых перемещений и ручных
          количеств. Предыдущая работа остаётся в истории.
        </p>
      )}

      <div className="upload-grid">
        <FileCard
          title="Отчёт MIN/MAX"
          accept=".xlsx"
          fileName={state.minMaxFileName}
          ready={Boolean(state.minMax)}
          busy={state.minMaxLoading}
          summary={
            state.minMax
              ? `${state.minMax.skus.length} SKU · ${state.minMax.branches.length} подразделений`
              : null
          }
          issues={state.minMaxIssues}
          onFile={(file) => load(file, 'min')}
        />
        <FileCard
          title="Отчёт поставщиков"
          accept=".xls,.xlsx"
          fileName={state.supplierFileName}
          ready={Boolean(state.suppliers)}
          busy={state.supplierLoading}
          summary={
            state.suppliers
              ? `${supplierPoolCount} поставщиков в рабочем пуле · скрыто: ${
                  state.suppliers.suppliers.length - supplierPoolCount
                } · ${state.suppliers.history.length} связок в исходном отчёте`
              : null
          }
          issues={state.supplierIssues}
          onFile={(file) => load(file, 'sup')}
        />
      </div>

      {supplierResolutionSummary && (
        <section className="import-resolution panel">
          <h2>Готовность к формированию заказов</h2>
          <div className="resolution-grid">
            <span>
              Несколько поставщиков:{' '}
              <strong>{supplierResolutionSummary.multiple}</strong>
            </span>
            <span>
              Нет поставщика:{' '}
              <strong>{supplierResolutionSummary.withoutSupplier}</strong>
            </span>
            <span>
              Устаревший выбор:{' '}
              <strong>{supplierResolutionSummary.stale}</strong>
            </span>
          </div>
          <p>
            Эти позиции не потеряются: приложение оставит их в блоке «Требуют
            решения» до выбора поставщика.
          </p>
        </section>
      )}

      <Button
        disabled={!state.minMax || !state.suppliers || anyLoading}
        onClick={() => set({ page: 'all', toast: 'Потребность рассчитана.' })}
      >
        Перейти к потребности
      </Button>
      {state.minMax && state.suppliers && !anyLoading && (
        <p className="import-ready" role="status">
          Оба отчёта загружены. Можно перейти к работе с потребностью.
        </p>
      )}
    </main>
  );
}

function FileCard({
  title,
  accept,
  fileName,
  ready,
  busy,
  summary,
  issues,
  onFile,
}: {
  title: string;
  accept: string;
  fileName: string | null;
  ready: boolean;
  busy: boolean;
  summary: string | null;
  issues: ValidationIssue[];
  onFile: (file: File) => void;
}) {
  const warnings = issues.filter((issue) => issue.severity === 'WARNING');
  const errors = issues.filter((issue) => issue.severity === 'ERROR');

  return (
    <section
      className={`upload ${errors.length > 0 ? 'has-error' : ''}`}
      aria-busy={busy}
    >
      <div className="upload-icon" aria-hidden="true">
        {ready ? '✓' : '⇧'}
      </div>
      <h2>{title}</h2>
      <p>{accept.replaceAll(',', ' / ')} · отчёт из 1С</p>
      {fileName && <div className="file-name">{fileName}</div>}

      <label className="button secondary">
        {busy ? 'Обработка…' : fileName ? 'Заменить файл' : 'Выбрать файл'}
        <input
          className="sr-only"
          aria-label={`Выбрать файл ${title}`}
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFile(file);
              event.target.value = '';
            }
          }}
        />
      </label>

      <strong
        className={ready ? 'success' : errors.length ? 'danger-text' : ''}
      >
        {busy
          ? 'Обработка файла…'
          : ready
            ? 'Успешно распознан'
            : errors.length
              ? 'Файл требует исправления'
              : 'Файл не загружен'}
      </strong>
      {summary && <small>{summary}</small>}
      {(warnings.length > 0 || errors.length > 0) && (
        <IssueList issues={issues} />
      )}
    </section>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const visible = issues.slice(0, 6);
  return (
    <div className="issue-list">
      <strong>
        Проверка данных: {issues.length}{' '}
        {issues.length === 1 ? 'сообщение' : 'сообщений'}
      </strong>
      <ul>
        {visible.map((issue, index) => (
          <li
            key={`${issue.code}:${issue.skuCode ?? ''}:${
              issue.branch ?? ''
            }:${index}`}
          >
            <span className={`issue-dot ${issue.severity.toLowerCase()}`} />
            {issue.message}
          </li>
        ))}
      </ul>
      {issues.length > visible.length && (
        <small>Ещё сообщений: {issues.length - visible.length}</small>
      )}
    </div>
  );
}
