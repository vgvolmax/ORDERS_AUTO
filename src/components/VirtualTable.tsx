import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const VIRTUALIZATION_THRESHOLD = 100;

export interface VirtualColumn<T> {
  key: string;
  header: ReactNode;
  width: string;
  className?: string | undefined;
  render: (row: T) => ReactNode;
}

export function VirtualTable<T>({
  rows,
  columns,
  getRowKey,
  renderDetails,
  emptyMessage = 'Нет данных по выбранным фильтрам.',
}: {
  rows: T[];
  columns: VirtualColumn<T>[];
  getRowKey: (row: T) => string;
  renderDetails?: ((row: T) => ReactNode) | undefined;
  emptyMessage?: string | undefined;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 58,
    overscan: 10,
  });
  const template = columns.map((column) => column.width).join(' ');

  if (rows.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }

  return (
    <div className="virtual-table" role="table">
      <TableHeader columns={columns} template={template} />

      {shouldVirtualize ? (
        <div className="virtual-scroll" ref={scrollRef}>
          <div
            className="virtual-spacer"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]!;
              return (
                <TableRow
                  key={getRowKey(row)}
                  row={row}
                  columns={columns}
                  template={template}
                  details={renderDetails?.(row)}
                  measureRef={virtualizer.measureElement}
                  dataIndex={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                />
              );
            })}
          </div>
        </div>
      ) : (
        // Small result sets are cheaper and more accessible as ordinary DOM
        // rows. Large operational datasets still use virtualization.
        <div className="virtual-scroll virtual-scroll-static">
          {rows.map((row, index) => (
            <TableRow
              key={getRowKey(row)}
              row={row}
              columns={columns}
              template={template}
              details={renderDetails?.(row)}
              dataIndex={index}
              staticRow
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TableHeader<T>({
  columns,
  template,
}: {
  columns: VirtualColumn<T>[];
  template: string;
}) {
  return (
    <div
      className="virtual-header"
      role="row"
      style={{ gridTemplateColumns: template }}
    >
      {columns.map((column) => (
        <div
          key={column.key}
          className={column.className}
          role="columnheader"
        >
          {column.header}
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
  staticRow = false,
}: {
  row: T;
  columns: VirtualColumn<T>[];
  template: string;
  details: ReactNode;
  measureRef?: ((node: Element | null) => void) | undefined;
  dataIndex: number;
  style?: React.CSSProperties | undefined;
  staticRow?: boolean | undefined;
}) {
  return (
    <div
      ref={measureRef}
      data-index={dataIndex}
      className={`virtual-row-shell${staticRow ? ' virtual-row-shell-static' : ''}`}
      role="row"
      style={style}
    >
      <div
        className="virtual-row"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column) => (
          <div
            key={column.key}
            className={column.className}
            role="cell"
          >
            {column.render(row)}
          </div>
        ))}
      </div>
      {details}
    </div>
  );
}
