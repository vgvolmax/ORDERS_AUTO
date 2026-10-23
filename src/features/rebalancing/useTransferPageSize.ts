import { useLayoutEffect, useRef, useState } from 'react';

/** Only the composition table owns viewport sizing; sibling tabs keep document scroll. */
export function useTransferPageSize() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(3);
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => {
      if (!node.clientHeight) return;
      const header =
        node.querySelector('.virtual-header')?.getBoundingClientRect().height ??
        38;
      const row =
        Number.parseFloat(
          getComputedStyle(node).getPropertyValue('--transfer-row-height'),
        ) || 108;
      setPageSize(
        Math.max(
          1,
          Math.min(12, Math.floor((node.clientHeight - header - 2) / row)),
        ),
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { frameRef, pageSize };
}
