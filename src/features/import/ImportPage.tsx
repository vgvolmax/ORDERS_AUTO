import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { derive } from '../../app/selectors';
import { RebalanceError } from '../../domain/rebalancing/types';
import { isSupplierInPool, supplierKey } from '../../domain/supplierPool';
import type { ValidationIssue } from '../../domain/types';
import { MIN_MAX_PARSER_VERSION, parseMinMaxWorkbook } from '../../import/minMaxParser';
import { parseSupplierWorkbook } from '../../import/supplierParser';
import { Alert, Button } from '../../components/ui';
import { ImportIssues } from './ImportIssues';
import { loadWorkspaceFile } from '../../persistence/workspaces';

export function ImportPage() {
  const { state, set, commit, saving } = useStore();
  const reads = useRef({ min: 0, sup: 0 });
  const pendingReads = useRef(new Set<'min' | 'sup'>());
  const [failures, setFailures] = useState({ min: '', sup: '' });
  const configured = state.supplierAssignments !== undefined;
  const ready = Boolean(state.minMax && configured);
  const resumeSetup = !configured && Boolean(state.minMax && state.suppliers);
  const anyLoading = state.minMaxLoading || state.supplierLoading;
  const supplierPoolCount = new Set(
    state.suppliers?.suppliers.filter(isSupplierInPool).map(supplierKey),
  ).size;

  // Cleanup belongs to the session that mounted this import page.
  useEffect(() => {
    const active = pendingReads.current;
    const tokens = reads.current;
    return () => {
      if (!active.size) return;
      for (const kind of active) tokens[kind]++;
      set({
        ...(active.has('min') ? { minMaxLoading: false } : {}),
        ...(active.has('sup') ? { supplierLoading: false } : {}),
      });
      active.clear();
    };
  }, []);

  const supplierResolutionSummary = useMemo(() => {
    if (!ready) return null;
    try {
      const { projection } = derive(state);
      const unassigned = new Map(
        projection.unassigned.map(({ demand, supplierResolution }) => [
          demand.skuCode,
          supplierResolution.candidates.length,
        ]),
      );
      return {
        unassigned: unassigned.size,
        withAdditional: [...unassigned.values()].filter((count) => count > 0)
          .length,
      };
    } catch (error) {
      // Keep import available so the operator can replace unusable source data.
      if (error instanceof RebalanceError) return null;
      throw error;
    }
  }, [ready, state]);

  async function load(file: File, kind: 'min' | 'sup') {
    const token = ++reads.current[kind],
      epoch = state.importEpoch;
    pendingReads.current.add(kind);
    set(kind === 'min' ? { minMaxLoading: true } : { supplierLoading: true });
    setFailures((previous) => ({ ...previous, [kind]: '' }));
    try {
      const bytes = await file.arrayBuffer();
      if (reads.current[kind] !== token) return;
      const activeFile = state.rawImports.minMax;
      if (
        kind === 'min' &&
        activeFile?.parserVersion === MIN_MAX_PARSER_VERSION &&
        activeFile.name === file.name &&
        activeFile.size === bytes.byteLength
      ) {
        const saved = await loadWorkspaceFile(activeFile.fileId);
        if (reads.current[kind] !== token) return;
        const incoming = new Uint8Array(bytes);
        if (
          saved?.bytes.byteLength === incoming.byteLength &&
          new Uint8Array(saved.bytes).every((byte, index) => byte === incoming[index])
        ) {
          set({ toast: 'Этот отчёт MIN/MAX уже загружен. Продолжайте работу в текущем сеансе.' });
          return;
        }
      }
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
        ...(kind === 'min' ? { parserVersion: MIN_MAX_PARSER_VERSION } : {}),
      };
      const update = (current: typeof state) =>
        reads.current[kind] !== token ||
        current.importEpoch !== epoch ||
        (kind === 'sup' && current.supplierAssignments !== undefined)
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
      if (reads.current[kind] === token) {
        pendingReads.current.delete(kind);
        set(
          kind === 'min'
            ? { minMaxLoading: false }
            : { supplierLoading: false },
        );
      }
    }
  }

  return (
    <main>
      <header className="header-actions">
        <div>
          <p className="eyebrow">Рабочий сеанс</p>
          <h1>Импорт отчётов 1С</h1>
          <p>
            {resumeSetup
              ? 'Оба отчёта сохранены. Нажмите «Перейти к потребности», чтобы подготовить связи поставщиков.'
              : configured
                ? 'Для следующей недели загрузите только отчёт MIN/MAX.'
                : 'Для начала загрузите отчёты MIN/MAX и поставщиков в любом порядке.'}{' '}
            Файлы обрабатываются только в браузере.
          </p>
        </div>
        <Button
          disabled={!(ready || resumeSetup) || anyLoading || saving}
          onClick={() => set({ page: 'all', toast: 'Потребность рассчитана.' })}
        >
          Перейти к потребности
        </Button>
      </header>
      <details className="import-help">
        <summary>Какие отчёты загрузить</summary>
        <p>
          MIN/MAX — отчёт с кодом, артикулом, наименованием, остатками и
          нормативами по подразделениям и закупочной ценой. При первом запуске
          отчёт поставщиков связывает товары с контрагентами по полному коду 1С.
        </p>
      </details>

      {anyLoading && <Alert>Обработка отчёта…</Alert>}
      {failures.min && <Alert tone="danger">MIN/MAX: {failures.min}</Alert>}
      {failures.sup && <Alert tone="danger">Поставщики: {failures.sup}</Alert>}
      {configured && (
        <p>
          После успешной загрузки текущий сеанс останется в истории. Новый
          сеанс возьмёт актуальные назначения из справочника и сохранит маршруты и условия.
          Принятые перемещения, ручные количества и отметки заказов сбросятся.
        </p>
      )}
      {!configured && state.suppliers && !state.minMax && (
        <p>Осталось загрузить отчёт MIN/MAX.</p>
      )}
      {!configured && state.minMax && !state.suppliers && (
        <p>Осталось загрузить отчёт поставщиков.</p>
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
          locked={configured}
          summary={
            state.suppliers
              ? `${supplierPoolCount} поставщиков в рабочем пуле · ${state.suppliers.history.length} связок в исходном отчёте`
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
              Без основного поставщика{' '}
              <strong>{supplierResolutionSummary.unassigned}</strong>
            </span>
            <span>
              Из них с дополнительными{' '}
              <strong>{supplierResolutionSummary.withAdditional}</strong>
            </span>
          </div>
          <p>
            Назначьте им основного поставщика в разделе «Поставщики», чтобы
            добавить потребность в заказы.
          </p>
        </section>
      )}

      {ready && !anyLoading && (
        <p className="import-ready" role="status">
          Отчёт MIN/MAX сохранён. Можно перейти к работе с потребностью.
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
  locked = false,
  summary,
  issues,
  onFile,
}: {
  title: string;
  accept: string;
  fileName: string | null;
  ready: boolean;
  busy: boolean;
  locked?: boolean;
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

      {!locked && (
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
      )}

      <strong
        className={ready ? 'success' : errors.length ? 'danger-text' : ''}
      >
        {locked
          ? 'Использован при первичной настройке'
          : busy
            ? 'Обработка файла…'
            : ready
              ? 'Успешно распознан'
              : errors.length
                ? 'Файл требует исправления'
                : 'Файл не загружен'}
      </strong>
      {summary && <small>{summary}</small>}
      {(warnings.length > 0 || errors.length > 0) && (
        <ImportIssues title={title} issues={issues} />
      )}
    </section>
  );
}
