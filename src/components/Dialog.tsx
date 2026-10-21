import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
const stack: HTMLElement[] = [];
export function useModalLayer(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const surface = ref.current; if (!surface) return;
    const trigger = document.activeElement as HTMLElement | null;
    stack.push(surface);
    const roots = [...document.body.children].filter((el) => !el.contains(surface)) as HTMLElement[];
    const previous = roots.map((el) => el.inert); roots.forEach((el) => { el.inert = true; });
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => [...surface.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter((el) => !el.hidden && !el.closest('[hidden]'));
    (focusable()[0] ?? surface).focus();
    const key = (e: KeyboardEvent) => {
      if (stack.at(-1) !== surface) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); }
      if (e.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!first) { e.preventDefault(); surface.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); stack.splice(stack.indexOf(surface), 1); roots.forEach((el, i) => { el.inert = previous[i]!; }); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
  }, [ref]);
}
export function Dialog({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const ref = useRef<HTMLElement>(null), id = useId(); useModalLayer(ref, onClose);
  return createPortal(<div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className="modal-surface"><div className="modal-heading"><h2 id={id}>{title}</h2><button className="close" aria-label="Закрыть окно" onClick={onClose}>×</button></div><div className="modal-body">{children}</div>{actions && <div className="modal-actions">{actions}</div>}</section></div>, document.body);
}
