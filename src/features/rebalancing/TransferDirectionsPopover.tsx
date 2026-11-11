import { useLayoutEffect, useRef } from 'react';
import type { TransferQuantityDetails } from '../../domain/rebalancing/manualTransferQuantity';
import { fmtQty } from '../demand/DemandPage';
import {
  transferDecisionLabel,
  type TransferDirection,
} from './transferDocuments';

export function TransferDirectionsPopover({
  id,
  anchor,
  skuCode,
  unit,
  directions,
  currentDirectionId,
  quantity,
  warnings,
  onClose,
}: {
  id: string;
  anchor: HTMLButtonElement;
  skuCode: string;
  unit: string | null;
  directions: TransferDirection[];
  currentDirectionId: string;
  quantity: TransferQuantityDetails | null;
  warnings: string[];
  onClose: (restoreFocus: boolean) => void;
}) {
  const popupRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const drawer = anchor.closest('.transfer-drawer');
    const scroller = anchor.closest('.virtual-scroll');
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const scrollBounds = scroller?.getBoundingClientRect();
      if (
        !anchor.isConnected ||
        (scrollBounds &&
          bounds.height > 0 &&
          (bounds.bottom <= scrollBounds.top ||
            bounds.top >= scrollBounds.bottom ||
            bounds.right <= scrollBounds.left ||
            bounds.left >= scrollBounds.right))
      ) {
        close.current(false);
        return;
      }

      const margin = 8;
      const drawerBounds = drawer?.getBoundingClientRect();
      const topEdge = Math.max(margin, (drawerBounds?.top ?? 0) + margin);
      const bottomEdge = Math.min(
        window.innerHeight - margin,
        (drawerBounds?.bottom || window.innerHeight) - margin,
      );
      const rightEdge = Math.min(
        window.innerWidth - margin,
        (drawerBounds?.right || window.innerWidth) - margin,
      );
      const leftEdge = Math.max(margin, (drawerBounds?.left ?? 0) + margin);
      const above = bounds.top - margin - topEdge;
      const below = bottomEdge - bounds.bottom - margin;
      const contentHeight =
        popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
      const opensBelow =
        below >= Math.min(360, contentHeight) || below >= above;
      const height = Math.min(360, Math.max(0, opensBelow ? below : above));
      popup.style.maxHeight = `${height}px`;
      const left = Math.min(bounds.left, rightEdge - popup.offsetWidth);
      const top = opensBelow
        ? bounds.bottom + margin
        : bounds.top - margin - popup.offsetHeight;
      popup.style.left = `${Math.max(leftEdge, left)}px`;
      popup.style.top = `${Math.max(topEdge, top)}px`;
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popup.contains(event.target)) return;
      position();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.contains(event.target) &&
        !anchor.contains(event.target)
      ) {
        close.current(false);
      }
    };
    position();
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', position);
    };
  }, [anchor, directions, quantity?.maxQty, quantity?.reservedOtherQty]);
  useLayoutEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [anchor]);

  const unitLabel = unit ?? 'ед.';
  return (
    <section
      className="transfer-directions-popover"
      ref={popupRef}
      role="dialog"
      id={id}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
    >
      <div className="transfer-directions-heading">
        <h3 id={`${id}-title`}>Направления товара {skuCode}</h3>
        <button
          type="button"
          ref={closeRef}
          className="close"
          aria-label="Закрыть направления"
          onClick={() => onClose(true)}
        >
          ×
        </button>
      </div>
      {quantity && (
        <dl className="transfer-direction-summary">
          <div>
            <dt>Зарезервировано на другие направления:</dt>
            <dd>
              {fmtQty(quantity.reservedOtherQty)} {unitLabel}
            </dd>
          </div>
          <div>
            <dt>Максимум для этого направления:</dt>
            <dd>
              {fmtQty(quantity.maxQty)} {unitLabel}
            </dd>
          </div>
        </dl>
      )}
      {warnings.length > 0 && (
        <ul className="warning-text transfer-direction-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <ul className="transfer-direction-list">
        {directions.map((direction) => (
          <li
            key={direction.id}
            aria-current={
              direction.id === currentDirectionId ? 'true' : undefined
            }
          >
            <div>
              <strong>
                {direction.fromName} → {direction.toName}
              </strong>
              {direction.id === currentDirectionId && (
                <small>Текущее направление</small>
              )}
            </div>
            <ul className="transfer-direction-lines">
              {direction.lines.map((line) => (
                <li key={line.id}>
                  <strong>
                    {fmtQty(line.qty)} {line.unit ?? 'ед.'}
                  </strong>
                  <span data-decision={line.decision}>
                    {transferDecisionLabel[line.decision]}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
