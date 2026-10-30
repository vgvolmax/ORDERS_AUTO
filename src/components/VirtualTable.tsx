import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Dialog } from './Dialog';
import { Button } from './ui';

const VIRTUALIZATION_THRESHOLD = 100;

export interface VirtualColumn<T> {
  key: string;
  header: ReactNode;
  width: string;
  className?: string | undefined;
  render: (row: T) => ReactNode;
  sticky?: boolean;
  hideable?: boolean;
  sortValue?: (row: T) => string | number | null;
}

export interface TableSort {
  key: string;
  direction: 'asc' | 'desc';
}
const collator = new Intl.Collator('ru-RU', {
  numeric: true,
  sensitivity: 'base',
});
const minimumColumnWidth = <T,>(column: VirtualColumn<T>) =>
  Number(column.width.match(/(?:minmax\()?([0-9.]+)px/)?.[1] ?? 80);

export function VirtualTable<T>({
  rows,
  columns,
  getRowKey,
  renderDetails,
  maxHeight,
  rowClassName,
  estimateRowHeight = 58,
  sort,
  onSortChange,
  hiddenColumns = [],
  onHiddenColumnsChange,
  emptyMessage = 'Нет данных по выбранным фильтрам.',
}: {
  rows: T[];
  columns: VirtualColumn<T>[];
  getRowKey: (row: T) => string;
  renderDetails?: ((row: T) => ReactNode) | undefined;
  maxHeight?: string | undefined;
  rowClassName?: string | undefined;
  estimateRowHeight?: number;
  emptyMessage?: string | undefined;
  sort?: TableSort | null;
  onSortChange?: (value: TableSort | null) => void;
  hiddenColumns?: string[];
  onHiddenColumnsChange?: (keys: string[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [columnOptionsOpen, setColumnOptionsOpen] = useState(false);
  const visibleColumns = columns.filter(
    (column) =>
      column.hideable === false || !hiddenColumns.includes(column.key),
  );
  const displayedRows = useMemo(() => {
    const value = columns.find((column) => column.key === sort?.key)?.sortValue;
    if (!value || !sort) return rows;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = value(a),
        right = value(b);
      const absent = (v: string | number | null) =>
        v === null || (typeof v === 'number' && !Number.isFinite(v));
      if (absent(left)) return absent(right) ? 0 : 1;
      if (absent(right)) return -1;
      return (
        direction *
        (typeof left === 'number' && typeof right === 'number'
          ? left - right
          : collator.compare(String(left), String(right)))
      );
    });
  }, [rows, columns, sort]);
  const stickyOffsets = new Map<string, number>();
  let frozenWidth = 0;
  for (const column of visibleColumns) {
    if (!column.sticky) continue;
    stickyOffsets.set(column.key, frozenWidth);
    frozenWidth += minimumColumnWidth(column);
  }
  const hasRows = rows.length > 0;
  useLayoutEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const measure = () => setHeaderHeight(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasRows]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [sort?.key, sort?.direction]);
  const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
    scrollMargin: headerHeight,
  });
  const template = visibleColumns.map((column) => column.width).join(' ');
  const minimumWidth = visibleColumns.reduce(
    (sum, column) => sum + minimumColumnWidth(column),
    0,
  );

  if (rows.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }

  return (
    <div className="virtual-table">
      {onHiddenColumnsChange && (
        <div className="table-tools">
          <span>Позиций: {rows.length}</span>
          <Button
            className="secondary table-options-trigger"
            onClick={() => setColumnOptionsOpen(true)}
          >
            Столбцы
          </Button>
        </div>
      )}
      <div
        className="virtual-scroll"
        ref={scrollRef}
        tabIndex={0}
        aria-label="Прокрутка таблицы"
        style={{
          height: shouldVirtualize ? undefined : 'auto',
          maxHeight: maxHeight ?? 'min(68vh, 720px)',
        }}
      >
        <div
          role="table"
          aria-rowcount={rows.length + 1}
          aria-colcount={visibleColumns.length}
          style={{ minWidth: minimumWidth }}
        >
          <TableHeader
            columns={visibleColumns}
            template={template}
            headerRef={headerRef}
            stickyOffsets={stickyOffsets}
            sort={sort}
            onSortChange={onSortChange}
          />
          {shouldVirtualize ? (
            <div
              className="virtual-spacer"
              role="rowgroup"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = displayedRows[virtualRow.index]!;
                return (
                  <TableRow
                    rowClassName={rowClassName}
                    key={getRowKey(row)}
                    row={row}
                    columns={visibleColumns}
                    stickyOffsets={stickyOffsets}
                    template={template}
                    details={renderDetails?.(row)}
                    measureRef={virtualizer.measureElement}
                    dataIndex={virtualRow.index}
                    style={{
                      transform: `translateY(${
                        virtualRow.start - headerHeight
                      }px)`,
                    }}
                  />
                );
              })}
            </div>
          ) : (
            // Small result sets are cheaper and more accessible as ordinary DOM
            // rows. Large operational datasets still use virtualization.
            <div role="rowgroup">
              {displayedRows.map((row, index) => (
                <TableRow
                  rowClassName={rowClassName}
                  key={getRowKey(row)}
                  row={row}
                  columns={visibleColumns}
                  stickyOffsets={stickyOffsets}
                  template={template}
                  details={renderDetails?.(row)}
                  dataIndex={index}
                  style={{ position: 'relative', top: 'auto', left: 'auto' }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {columnOptionsOpen && onHiddenColumnsChange && (
        <Dialog
          title="Столбцы таблицы"
          onClose={() => setColumnOptionsOpen(false)}
          actions={
            <>
              <Button
                className="secondary"
                onClick={() => onHiddenColumnsChange([])}
              >
                Показать все
              </Button>
              <Button onClick={() => setColumnOptionsOpen(false)}>
                Закрыть настройки столбцов
              </Button>
            </>
          }
        >
          <p>
            Код, артикул и наименование остаются видимыми. Настройки сохраняются
            для этого раздела.
          </p>
          <div className="column-options">
            {columns
              .filter((column) => column.hideable !== false)
              .map((column) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    aria-label={`Показать столбец ${String(column.header)}`}
                    checked={!hiddenColumns.includes(column.key)}
                    onChange={(event) => {
                      onHiddenColumnsChange(
                        event.target.checked
                          ? hiddenColumns.filter((key) => key !== column.key)
                          : [...hiddenColumns, column.key],
                      );
                      if (!event.target.checked && sort?.key === column.key)
                        onSortChange?.(null);
                    }}
                  />
                  {column.header}
                </label>
              ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function TableHeader<T>({
  columns,
  template,
  headerRef,
  stickyOffsets,
  sort,
  onSortChange,
}: {
  columns: VirtualColumn<T>[];
  template: string;
  headerRef: RefObject<HTMLDivElement | null>;
  stickyOffsets: Map<string, number>;
  sort: TableSort | null | undefined;
  onSortChange: ((value: TableSort | null) => void) | undefined;
}) {
  return (
    <div
      ref={headerRef}
      className="virtual-header"
      role="row"
      aria-rowindex={1}
      style={{ gridTemplateColumns: template }}
    >
      {columns.map((column) => (
        <div
          key={column.key}
          className={`${column.className ?? ''}${column.sticky ? ' is-frozen' : ''}`}
          role="columnheader"
          aria-label={
            typeof column.header === 'string' ? column.header : undefined
          }
          style={
            column.sticky
              ? { position: 'sticky', left: stickyOffsets.get(column.key) }
              : undefined
          }
          aria-sort={
            sort?.key === column.key
              ? sort.direction === 'asc'
                ? 'ascending'
                : 'descending'
              : undefined
          }
        >
          {column.sortValue && onSortChange ? (
            <button
              className="table-sort"
              aria-label={`Сортировать: ${String(column.header)}`}
              onClick={() =>
                onSortChange({
                  key: column.key,
                  direction:
                    sort?.key === column.key && sort.direction === 'asc'
                      ? 'desc'
                      : 'asc',
                })
              }
            >
              {column.header}
              {sort?.key === column.key && (
                <span aria-hidden="true">
                  {sort.direction === 'asc' ? ' ↑' : ' ↓'}
                </span>
              )}
            </button>
          ) : (
            column.header
          )}
        </div>
      ))}
    </div>
  );
}

function TableRow<T>({
  row,
  columns,
  template,
  details,
  measureRef,
  dataIndex,
  style,
  rowClassName,
  stickyOffsets,
}: {
  row: T;
  columns: VirtualColumn<T>[];
  template: string;
  details: ReactNode;
  measureRef?: ((node: Element | null) => void) | undefined;
  dataIndex: number;
  style?: CSSProperties | undefined;
  rowClassName?: string | undefined;
  stickyOffsets: Map<string, number>;
}) {
  return (
    <div
      ref={measureRef}
      data-index={dataIndex}
      className="virtual-row-shell"
      role="row"
      aria-rowindex={dataIndex + 2}
      style={style}
    >
      <div
        className={`virtual-row ${rowClassName ?? ''}`}
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column) => (
          <div
            key={column.key}
            className={`${column.className ?? ''}${column.sticky ? ' is-frozen' : ''}`}
            role="cell"
            style={
              column.sticky
                ? { position: 'sticky', left: stickyOffsets.get(column.key) }
                : undefined
            }
          >
            {column.render(row)}
          </div>
        ))}
      </div>
      {details}
    </div>
  );
}
