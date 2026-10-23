import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Measured cards share one scroller; stable keys retain their height after edits. */
export function VirtualList<T>({
  items,
  getItemKey,
  renderItem,
  label,
  resetKey,
  emptyMessage,
}: {
  items: T[];
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  label: string;
  resetKey: string;
  emptyMessage: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = items.length > 100;
  const list = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => getItemKey(items[index]!),
    estimateSize: () => 220,
    overscan: 4,
  });
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey]);
  return (
    <div
      className="virtual-list"
      ref={scrollRef}
      role="list"
      aria-label={label}
      tabIndex={0}
    >
      {!items.length ? (
        <div className="empty">{emptyMessage}</div>
      ) : virtual ? (
        <div
          className="virtual-list-canvas"
          style={{ height: list.getTotalSize() }}
        >
          {list.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={list.measureElement}
              className="virtual-list-item is-virtual"
              role="listitem"
              aria-setsize={items.length}
              aria-posinset={item.index + 1}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {renderItem(items[item.index]!)}
            </div>
          ))}
        </div>
      ) : (
        items.map((item, index) => (
          <div
            className="virtual-list-item"
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={index + 1}
            key={getItemKey(item)}
          >
            {renderItem(item)}
          </div>
        ))
      )}
    </div>
  );
}
