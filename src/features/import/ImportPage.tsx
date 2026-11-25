import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/appStore';
import { derive } from '../../app/selectors';
import { RebalanceError } from '../../domain/rebalancing/types';
import { isSupplierInPool, supplierKey, SUPPLIER_POOL } from '../../domain/supplierPool';
import type { ValidationIssue } from '../../domain/types';
import { MIN_MAX_PARSER_VERSION, parseMinMaxWorkbook } from '../../import/minMaxParser';
import { parseSupplierWorkbook } from '../../import/supplierParser';
import { Dialog } from '../../components/Dialog';
import { Alert, Button } from '../../components/ui';
import { ImportIssues } from './ImportIssues';
import { loadWorkspaceFile } from '../../persistence/workspaces';
import { collectPurchasingIssues } from '../../domain/purchasingIssues';
import { SharedCatalogPanel } from '../suppliers/SharedCatalogPanel';

export function ImportPage() {
  const { state, set, commit, saving, shared } = useStore();
  const reads = useRef({ min: 0, sup: 0 });
  const pendingReads = useRef(new Set<'min' | 'sup'>());
  const [duplicate, setDuplicate] = useState<File | null>(null);
  const [failures, setFailures] = useState({ min: '', sup: '' });
  const configured = state.supplierAssignments !== undefined;
  const ready = Boolean(state.minMax && configured);
  const resumeSetup = !configured && Boolean(state.minMax && state.suppliers);
  const anyLoading = state.minMaxLoading || state.supplierLoading;
  const supplierPoolCount = new Set(
    state.suppliers?.suppliers.filter((supplier) => isSupplierInPool(supplier, state.catalog?.suppliers ?? SUPPLIER_POOL)).map(supplierKey),
  ).size;
  const minMaxIssues = useMemo(() => {
    if (!state.minMax) return state.minMaxIssues;
    const key = (issue: ValidationIssue) => JSON.stringify([issue.severity, issue.code, issue.skuCode, issue.branch]);
    const seen = new Set(state.minMaxIssues.map(key));
    return [...state.minMaxIssues, ...collectPurchasingIssues(state.minMax, []).filter((issue) => !seen.has(key(issue)))];
  }, [state.minMax, state.minMaxIssues]);

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

  async function load(file: File, kind: 'min' | 'sup', startNewSession = false) {
    if (shared && !shared.editable) return;
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
        !shared?.openReport && kind === 'min' && !startNewSession &&
        activeFile?.parserVersion === MIN_MAX_PARSER_VERSION &&
        activeFile.size === bytes.byteLength
      ) {
        const saved = await loadWorkspaceFile(activeFile.fileId);
        if (reads.current[kind] !== token) return;
        const incoming = new Uint8Array(bytes);
        if (
          saved?.bytes.byteLength === incoming.byteLength &&
          new Uint8Array(saved.bytes).every((byte, index) => byte === incoming[index])
        ) {
          if (file.name !== activeFile.name) setDuplicate(file);
          else set({ toast: 'Этот отчёт MIN/MAX уже загружен. Продолжайте работу в текущем сеансе.' });
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
      if (kind === 'min' && shared?.openReport) {
        if (reads.current[kind] !== token) return;
        await shared.openReport({
          minMax: result.data as NonNullable<typeof state.minMax>,
          minMaxFileName: file.name,
          minMaxIssues: result.issues,
          rawImports: { minMax: ref, suppliers: null },
          pendingFiles: [{ ...ref, bytes }],
        }, { ...ref, bytes });
        return;
      }
      if (kind === 'min' && shared && state.minMax && !shared.openReport)
        throw new Error('Для следующего отчёта создайте другой рабочий документ AppBox.');
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
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error &&
          error.code === 'DOCUMENT_INTAKE_CANCELLED') return;
      if (reads.current[kind] === token)
        setFailures((previous) => ({
          ...previous,
          [kind]: shared && error instanceof Error ? error.message :
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
          <p className="eyebrow">{shared ? 'Рабочий сеанс AppBox' : 'Рабочий сеанс'}</p>
          <h1>Импорт отчётов 1С</h1>
          <p>
            {resumeSetup
              ? 'Оба отчёта сохранены. Нажмите «Перейти к потребности», чтобы подготовить связи поставщиков.'
              : configured
                ? state.minMax ? 'Для следующей недели загрузите только отчёт MIN/MAX.' : 'Справочник готов. Загрузите MIN/MAX, чтобы начать работу.'
                : shared?.team ? 'Загрузите MIN/MAX. Для расчёта заказов нужен справочник отдела.' :
                  'Загрузите MIN/MAX и подключите справочник JSON либо стартовый отчёт поставщиков.'}{' '}
            {shared ? 'Отчёт обрабатывается в браузере и сохраняется в AppBox.' :
              'Файлы обрабатываются только в браузере.'}
          </p>
        </div>
        <Button
          disabled={!(ready || resumeSetup) || anyLoading || saving}
          onClick={() => set({ page: 'all', toast: 'Потребность рассчитана.' })}
        >
          {failures.min && state.minMax ? 'Продолжить со старым отчётом' : 'Перейти к потребности'}
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
      {failures.min && <Alert tone="danger">
        MIN/MAX: {failures.min}
        {state.minMaxFileName && ` Новый файл не принят. Активен: ${state.minMaxFileName}.`}
      </Alert>}
      {failures.sup && <Alert tone="danger">Поставщики: {failures.sup}</Alert>}
      {shared?.openReport ? (
        <p>Новый MIN/MAX откроется в отдельном документе пространства «{shared.team}».
          Повторная загрузка того же файла откроет существующий сеанс.</p>
      ) : configured && !shared ? (
        <p>
          После успешной загрузки текущий сеанс останется в истории. Новый
          сеанс возьмёт актуальные назначения из справочника и сохранит маршруты и условия.
          Принятые перемещения, ручные количества и отметки заказов сбросятся.
        </p>
      ) : null}
      <div className="upload-grid">
        <section aria-label="Загрузка остатков и нормативов">
          {!configured && <h2>1. Остатки и нормативы</h2>}
          <FileCard
            title="Отчёт MIN/MAX"
            accept=".xlsx"
            fileName={state.minMaxFileName}
            ready={Boolean(state.minMax)}
            busy={state.minMaxLoading}
            locked={Boolean(shared && (!shared.editable || (!shared.openReport && state.minMax)))}
            summary={
              state.minMax
                ? `${state.minMax.skus.length} SKU · ${state.minMax.branches.length} подразделений`
                : null
            }
            issues={minMaxIssues}
            onFile={(file) => load(file, 'min')}
          />
        </section>
        <section aria-label="Подключение поставщиков">
          {!configured && <><h2>2. Источник поставщиков</h2>
            {!shared?.team && <p>Откройте справочник JSON или выберите стартовый Excel.</p>}</>}
          {(shared || !configured || !state.minMax) && <SharedCatalogPanel compact />}
          {!shared?.team && <FileCard
            title="Отчёт поставщиков"
            accept=".xls,.xlsx"
            fileName={state.supplierFileName}
            ready={Boolean(state.suppliers)}
            busy={state.supplierLoading}
            locked={configured || Boolean(shared && !shared.editable)}
            catalogReady={configured && !state.suppliers}
            summary={
              state.suppliers
                ? `${supplierPoolCount} поставщиков в рабочем пуле · ${state.suppliers.history.length} связок в исходном отчёте`
                : null
            }
            issues={state.supplierIssues}
            onFile={(file) => load(file, 'sup')}
          />}
        </section>
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
          {supplierResolutionSummary.unassigned > 0 && (
            <Button className="secondary" onClick={() => set((current) => ({
              page: 'suppliers',
              uiPreferences: { ...current.uiPreferences, 'suppliers:productFilters': {
                query: '', primary: 'without-primary', supplier: '', role: 'any', hasDemand: true,
              } },
            }))}>Открыть неназначенные товары</Button>
          )}
        </section>
      )}

      {ready && !anyLoading && !failures.min && (
        <p className="import-ready" role="status">
          Отчёт MIN/MAX сохранён. Можно перейти к работе с потребностью.
        </p>
      )}
      {duplicate && (
        <Dialog title="В файле тот же отчёт MIN/MAX" onClose={() => setDuplicate(null)} actions={<>
          <Button onClick={() => setDuplicate(null)}>Продолжить текущий сеанс</Button>
          <Button className="secondary" disabled={saving || anyLoading} onClick={() => {
            const file = duplicate;
            setDuplicate(null);
            void load(file, 'min', true);
          }}>Начать новый сеанс</Button>
        </>}>
          <p>Активный файл: {state.minMaxFileName}. Выбранный файл: {duplicate.name}.</p>
          <p>В новом сеансе останутся условия и маршруты. Перемещения, правки и отметки текущего сеанса сохранятся в истории.</p>
        </Dialog>
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
  catalogReady = false,
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
  catalogReady?: boolean;
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
        {busy ? '⇧' : ready && (errors.length || warnings.length) ? '!' : ready || catalogReady ? '✓' : '⇧'}
      </div>
      <h2>{catalogReady ? 'Связи поставщиков' : title}</h2>
      <p>{catalogReady ? 'Связи из справочника JSON' : `${accept.replaceAll(',', ' / ')} · отчёт из 1С`}</p>
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
        className={busy ? '' : errors.length ? 'danger-text' : ready && warnings.length ? 'warning-text' : ready || catalogReady ? 'success' : ''}
      >
        {catalogReady ? 'Справочник подключён. Отчёт поставщиков не требуется.' : busy ? 'Обработка файла…' : ready
          ? errors.length ? 'Прочитан с ошибками' : warnings.length ? 'Прочитан с предупреждениями' : 'Успешно распознан'
          : errors.length ? 'Файл требует исправления' : 'Файл не загружен'}
      </strong>
      {locked && !catalogReady && <small>Использован при первичной настройке</small>}
      {summary && <small>{summary}</small>}
      {(warnings.length > 0 || errors.length > 0) && (
        <ImportIssues title={title} issues={issues} />
      )}
    </section>
  );
}
