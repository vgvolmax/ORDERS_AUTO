import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, Select } from '../../components/ui';
import type {
  BranchRegistry,
  RebalanceBranch,
  RouteConfig,
  RouteDirection,
} from '../../domain/rebalancing/types';
import {
  setBranchRoutes,
  setRouteDirection,
} from '../../domain/rebalancing/routeEditing';
import './RoutesMatrix.css';

const reverse = (direction: RouteDirection): RouteDirection =>
  direction === 'A_TO_B'
    ? 'B_TO_A'
    : direction === 'B_TO_A'
      ? 'A_TO_B'
      : direction;
const symbols: Record<RouteDirection, string> = {
  BOTH: '↔',
  A_TO_B: '→',
  B_TO_A: '←',
  BLOCKED: '×',
};
const labels: Record<RouteDirection, string> = {
  BOTH: 'В обе стороны',
  A_TO_B: 'Только отправляет',
  B_TO_A: 'Только получает',
  BLOCKED: 'Запрещено',
};
type Editor = {
  branchId: string;
  otherId: string | null;
  direction: RouteDirection | null;
};

export function RoutesMatrix({
  registry,
  value,
  onChange,
  onRegistryChange,
}: {
  registry: BranchRegistry;
  value: RouteConfig;
  onChange: (config: RouteConfig) => void;
  onRegistryChange: (registry: BranchRegistry) => void;
}) {
  const root = useRef<HTMLElement>(null),
    tools = useRef<HTMLDivElement>(null),
    header = useRef<HTMLTableSectionElement>(null);
  const radioName = useId(),
    helpId = useId();
  const [capacity, setCapacity] = useState({ rows: 9, columns: 9 });
  const [rowPage, setRowPage] = useState(0),
    [columnPage, setColumnPage] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const direction = (a: string, b: string): RouteDirection => {
    const pair = value.pairs.find(
      (p) =>
        (p.branchAId === a && p.branchBId === b) ||
        (p.branchAId === b && p.branchBId === a),
    );
    return pair
      ? pair.branchAId === a
        ? pair.direction
        : reverse(pair.direction)
      : value.mode === 'ALL_ALLOWED'
        ? 'BOTH'
        : 'BLOCKED';
  };

  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current || !tools.current) return;
      const rect = root.current.getBoundingClientRect();
      if (!rect.width) return; // No layout in non-browser renderers.
      const styles = getComputedStyle(root.current);
      const rowHeight =
        Number.parseFloat(styles.getPropertyValue('--routes-row-height')) || 30;
      const longNames = registry.some((branch) => branch.name.length > 28);
      const columns = Math.max(
        1,
        Math.min(9, Math.floor((rect.width - 156) / (longNames ? 112 : 72))),
      );
      const available = window.innerHeight - rect.top - 12;
      const toolbarHeight = tools.current.getBoundingClientRect().height;
      const headerHeight = header.current?.getBoundingClientRect().height || 52;
      const notice = root.current.querySelector<HTMLElement>(
        '.routes-stale-pairs',
      );
      const noticeHeight = notice
        ? notice.getBoundingClientRect().height + 3
        : 0;
      // Reserve pagination before measuring, avoiding a page-count/layout oscillation.
      const rowBudget =
        available - toolbarHeight - headerHeight - noticeHeight - 4;
      const needsPages =
        registry.length > 9 ||
        columns < registry.length ||
        rowBudget < Math.min(9, registry.length) * rowHeight;
      const rows = Math.max(
        1,
        Math.min(
          9,
          Math.floor((rowBudget - (needsPages ? 32 : 0)) / rowHeight),
        ),
      );
      setCapacity((old) =>
        old.rows === rows && old.columns === columns ? old : { rows, columns },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    if (root.current) observer?.observe(root.current);
    if (tools.current) observer?.observe(tools.current);
    // A warning above the matrix moves it without resizing the matrix itself.
    const page = root.current?.closest('main');
    if (page) observer?.observe(page);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [registry]);

  const rowPages = Math.max(1, Math.ceil(registry.length / capacity.rows)),
    columnPages = Math.max(1, Math.ceil(registry.length / capacity.columns));
  const safeRowPage = Math.min(rowPage, rowPages - 1),
    safeColumnPage = Math.min(columnPage, columnPages - 1);
  const rows = registry.slice(
    safeRowPage * capacity.rows,
    (safeRowPage + 1) * capacity.rows,
  );
  const columns = registry.slice(
    safeColumnPage * capacity.columns,
    (safeColumnPage + 1) * capacity.columns,
  );
  const activeCount = registry.filter((branch) => branch.active).length;
  const selected = registry.find((branch) => branch.id === editor?.branchId);
  const other = registry.find((branch) => branch.id === editor?.otherId);
  const counterpartCount = selected?.active ? activeCount - 1 : 0;
  const editable =
    !!selected?.active &&
    (editor?.otherId ? !!other?.active : counterpartCount > 0);

  const branchHeader = (
    branch: RebalanceBranch,
    axis: 'строка' | 'столбец',
  ) => (
    <div
      className={`routes-branch routes-branch-${axis === 'строка' ? 'row' : 'column'}`}
    >
      <input
        type="checkbox"
        checked={branch.active}
        aria-label={`Участие ${branch.name}`}
        title={branch.active ? 'Участвует в новом расчёте' : 'Включить участие'}
        onChange={(event) =>
          onRegistryChange(
            registry.map((item) =>
              item.id === branch.id
                ? { ...item, active: event.target.checked }
                : item,
            ),
          )
        }
      />
      <Button
        className="routes-branch-button"
        aria-label={`Настроить направления ${branch.name}, ${axis}`}
        title={
          !branch.active
            ? `${branch.name} — выключено`
            : activeCount < 2
              ? `${branch.name} — нет других активных подразделений`
              : `Настроить направления: ${branch.name}`
        }
        disabled={!branch.active || activeCount < 2}
        onClick={() =>
          setEditor({ branchId: branch.id, otherId: null, direction: null })
        }
      >
        <span>{branch.name}</span>
        {!branch.active && <small>Выключено</small>}
      </Button>
    </div>
  );

  const pageControl = (
    axis: 'строки' | 'столбцы',
    page: number,
    count: number,
    size: number,
    change: (page: number) => void,
  ) => (
    <div className="routes-axis-pages">
      <span>
        {axis === 'строки' ? 'Строки' : 'Столбцы'} {page * size + 1}–
        {Math.min(registry.length, (page + 1) * size)} из {registry.length}
      </span>
      <Button
        className="secondary"
        aria-label={
          axis === 'строки' ? 'Предыдущие строки' : 'Предыдущие столбцы'
        }
        disabled={page === 0}
        onClick={() => change(page - 1)}
      >
        ←
      </Button>
      <Button
        className="secondary"
        aria-label={
          axis === 'строки' ? 'Следующие строки' : 'Следующие столбцы'
        }
        disabled={page === count - 1}
        onClick={() => change(page + 1)}
      >
        →
      </Button>
    </div>
  );

  return (
    <section
      ref={root}
      className="routes-editor"
      aria-label="Настройка маршрутов"
    >
      <div ref={tools} className="routes-tools">
        <div className="routes-mode">
          <label htmlFor={`${helpId}-mode`}>Режим маршрутов</label>
          <Select
            id={`${helpId}-mode`}
            value={value.mode}
            aria-describedby={helpId}
            onChange={(event) =>
              onChange({
                ...value,
                mode: event.target.value as RouteConfig['mode'],
              })
            }
          >
            <option value="ALL_ALLOWED">
              Ненастроенные пары — в обе стороны
            </option>
            <option value="SELECTIVE">Ненастроенные пары — запрещены</option>
          </Select>
          <span id={helpId}>
            Исключения сохраняются. Нажмите пару или название.
          </span>
        </div>
        <div className="routes-legend" aria-label="Обозначения направлений">
          <span className="routes-blocked">× Запрещено</span>
          <span className="routes-both">↔ В обе стороны</span>
          <span className="routes-oneway">→ / ← В одну сторону</span>
          <span>Флажок — участие; выключенные связи сохранены.</span>
        </div>
      </div>
      {!registry.length ? (
        <p className="routes-empty">
          Подразделений пока нет. Импортируйте отчёт MIN/MAX.
        </p>
      ) : (
        <>
          <table className="routes-grid" aria-label="Матрица маршрутов">
            <colgroup>
              <col className="routes-identity-column" />
              {columns.map((branch) => (
                <col key={branch.id} />
              ))}
            </colgroup>
            <thead ref={header}>
              <tr>
                <th scope="col" className="routes-corner">
                  Из строки →<br />в столбец
                </th>
                {columns.map((branch) => (
                  <th
                    scope="col"
                    key={branch.id}
                    className={
                      branch.active
                        ? 'routes-header-active'
                        : 'routes-header-inactive'
                    }
                  >
                    {branchHeader(branch, 'столбец')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((from) => (
                <tr key={from.id}>
                  <th
                    scope="row"
                    className={
                      from.active
                        ? 'routes-header-active'
                        : 'routes-header-inactive'
                    }
                  >
                    {branchHeader(from, 'строка')}
                  </th>
                  {columns.map((to) => {
                    const state = direction(from.id, to.id),
                      disabled = !from.active || !to.active;
                    const description =
                      state === 'A_TO_B'
                        ? `${from.name} → ${to.name}`
                        : state === 'B_TO_A'
                          ? `${to.name} → ${from.name}`
                          : labels[state];
                    const label = `Маршрут ${from.name} → ${to.name}: ${disabled ? 'Выключено; ' : ''}${description}`;
                    return (
                      <td key={to.id}>
                        {from.id === to.id ? (
                          <span
                            className="routes-diagonal"
                            aria-label="Внутри подразделения"
                          >
                            —
                          </span>
                        ) : (
                          <Button
                            className={`routes-cell routes-${disabled ? 'disabled' : state === 'BOTH' ? 'both' : state === 'BLOCKED' ? 'blocked' : 'oneway'}`}
                            aria-label={label}
                            title={label}
                            disabled={disabled}
                            onClick={() =>
                              setEditor({
                                branchId: from.id,
                                otherId: to.id,
                                direction: state,
                              })
                            }
                          >
                            {symbols[state]}
                          </Button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {(rowPages > 1 || columnPages > 1) && (
            <nav className="routes-pagination" aria-label="Страницы матрицы">
              {pageControl(
                'строки',
                safeRowPage,
                rowPages,
                capacity.rows,
                setRowPage,
              )}
              {pageControl(
                'столбцы',
                safeColumnPage,
                columnPages,
                capacity.columns,
                setColumnPage,
              )}
            </nav>
          )}
        </>
      )}
      {value.pairs.some(
        (pair) =>
          !registry.some((branch) => branch.id === pair.branchAId) ||
          !registry.some((branch) => branch.id === pair.branchBId),
      ) && (
        <p className="routes-stale-pairs">
          Сохранены маршруты отсутствующих подразделений; они не используются в
          этом снимке.
        </p>
      )}
      {editor && selected && (
        <Dialog
          title={
            other
              ? `Направление: ${selected.name} ↔ ${other.name}`
              : `Направления: ${selected.name}`
          }
          onClose={() => setEditor(null)}
          actions={
            <>
              <Button className="secondary" onClick={() => setEditor(null)}>
                Отмена
              </Button>
              <Button
                className="primary"
                disabled={!editable || !editor.direction}
                onClick={() => {
                  if (!editable || !editor.direction) return;
                  onChange(
                    other
                      ? setRouteDirection(
                          value,
                          registry,
                          selected.id,
                          other.id,
                          editor.direction,
                        )
                      : setBranchRoutes(
                          value,
                          registry,
                          selected.id,
                          editor.direction,
                        ),
                  );
                  setEditor(null);
                }}
              >
                Применить
              </Button>
            </>
          }
        >
          <div className="routes-direction-dialog">
            {!other && (
              <p>
                Будет изменено пар: {counterpartCount}. Все активные
                подразделения, включая другие страницы.
              </p>
            )}
            {!editable && (
              <p>
                Нет активных подразделений для изменения. Включите участие в
                матрице.
              </p>
            )}
            <fieldset disabled={!editable}>
              <legend>
                {other
                  ? 'Разрешённое направление'
                  : `Направление относительно «${selected.name}»`}
              </legend>
              {(['A_TO_B', 'B_TO_A', 'BOTH', 'BLOCKED'] as const).map(
                (state) => {
                  const label = other
                    ? state === 'A_TO_B'
                      ? `${selected.name} → ${other.name}`
                      : state === 'B_TO_A'
                        ? `${other.name} → ${selected.name}`
                        : state === 'BOTH'
                          ? 'В обе стороны'
                          : 'Запрещено'
                    : state === 'A_TO_B'
                      ? `Только отправляет: ${selected.name} → остальные`
                      : state === 'B_TO_A'
                        ? `Только получает: остальные → ${selected.name}`
                        : state === 'BOTH'
                          ? 'В обе стороны'
                          : 'Запретить всё';
                  return (
                    <label key={state}>
                      <input
                        type="radio"
                        name={radioName}
                        value={state}
                        checked={editor.direction === state}
                        onChange={() =>
                          setEditor({ ...editor, direction: state })
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                },
              )}
            </fieldset>
            <p className="routes-dialog-note">
              Принятые перемещения сохраняются. Для новых предложений
              потребуется пересчёт.
            </p>
          </div>
        </Dialog>
      )}
    </section>
  );
}
