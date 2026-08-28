import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

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
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 58,
    overscan: 10,
    // jsdom has no layout engine; initialRect also keeps the first rows visible
    // in integration tests without disabling virtualization in production.
    initialRect: { width: 1200, height: 640 },
  });
  const template = columns.map((column) => column.width).join(' ');

  if (rows.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }

  return (
    <div className="virtual-table" role="table">
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

      <div className="virtual-scroll" ref={scrollRef}>
        <div
          className="virtual-spacer"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            return (
              <div
                key={getRowKey(row)}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="virtual-row-shell"
                role="row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
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
                {renderDetails?.(row)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
