import { useMemo } from 'react';
import { useStore } from '../../app/appStore';
import { calculateDemand } from '../../domain/demand';
import { resolveSuppliers } from '../../domain/suppliers';
import type { ValidationIssue } from '../../domain/types';
import { parseMinMaxWorkbook } from '../../import/minMaxParser';
import { parseSupplierWorkbook } from '../../import/supplierParser';
import { Alert, Button } from '../../components/ui';

export function ImportPage() {
  const { state, set } = useStore();
  const anyLoading = state.minMaxLoading || state.supplierLoading;

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
      state.suppliers.history,
      state.overrides,
      [...neededSkuCodes],
    ).filter((resolution) => neededSkuCodes.has(resolution.skuCode));

    return {
      multiple: resolutions.filter((item) => item.status === 'MANUAL_REQUIRED').length,
      withoutSupplier: resolutions.filter((item) => item.status === 'UNRESOLVED').length,
      stale: resolutions.filter((item) => item.status === 'STALE_OVERRIDE').length,
    };
  }, [state.minMax, state.suppliers, state.overrides]);

  async function load(file: File, kind: 'min' | 'sup') {
    set(kind === 'min' ? { minMaxLoading: true } : { supplierLoading: true });
    try {
      const buffer = await file.arrayBuffer();
      if (kind === 'min') {
        const result = parseMinMaxWorkbook(buffer);
        set({
          minMax: result.fatal ? null : result.data,
          minMaxFileName: file.name,
          minMaxIssues: result.issues,
          toast: result.fatal
            ? 'Отчёт MIN/MAX не принят — исправьте ошибку файла.'
            : 'Отчёт MIN/MAX успешно распознан.',
        });
      } else {
        const result = parseSupplierWorkbook(buffer);
        set({
          suppliers: result.fatal ? null : result.data,
          supplierFileName: file.name,
          supplierIssues: result.issues,
          toast: result.fatal
            ? 'Отчёт поставщиков не принят — исправьте ошибку файла.'
            : 'Отчёт поставщиков успешно распознан.',
        });
      }
    } catch {
      if (kind === 'min') {
        set({
          minMax: null,
          minMaxFileName: file.name,
          minMaxIssues: [
            {
              severity: 'ERROR',
              code: 'MISSING_REQUIRED_COLUMN',
              message: 'Не удалось прочитать файл MIN/MAX.',
            },
          ],
        });
      } else {
        set({
          suppliers: null,
          supplierFileName: file.name,
          supplierIssues: [
            {
              severity: 'ERROR',
              code: 'MISSING_REQUIRED_COLUMN',
              message: 'Не удалось прочитать файл поставщиков.',
            },
          ],
        });
      }
    } finally {
      set(kind === 'min' ? { minMaxLoading: false } : { supplierLoading: false });
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Шаг 1 из 4</p>
        <h1>Импорт отчётов 1С</h1>
        <p>
          Загрузите два отчёта. Они обрабатываются только в браузере и никуда
          не отправляются.
        </p>
      </header>

      {anyLoading && <Alert>Обработка отчёта…</Alert>}

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
              ? `${state.suppliers.suppliers.length} поставщиков · ${state.suppliers.history.length} связок поставщик–SKU`
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
              Несколько поставщиков: <strong>{supplierResolutionSummary.multiple}</strong>
            </span>
            <span>
              Нет поставщика: <strong>{supplierResolutionSummary.withoutSupplier}</strong>
            </span>
            <span>
              Устаревший выбор: <strong>{supplierResolutionSummary.stale}</strong>
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
            }
          }}
        />
      </label>

      <strong className={ready ? 'success' : errors.length ? 'danger-text' : ''}>
        {busy
          ? 'Обработка файла…'
          : ready
            ? 'Успешно распознан'
            : errors.length
              ? 'Файл требует исправления'
              : 'Файл не загружен'}
      </strong>
      {summary && <small>{summary}</small>}
      {(warnings.length > 0 || errors.length > 0) && <IssueList issues={issues} />}
    </section>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const visible = issues.slice(0, 6);
  return (
    <div className="issue-list">
      <strong>
        Проверка данных: {issues.length} {issues.length === 1 ? 'сообщение' : 'сообщений'}
      </strong>
      <ul>
        {visible.map((issue, index) => (
          <li key={`${issue.code}:${issue.skuCode ?? ''}:${issue.branch ?? ''}:${index}`}>
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
