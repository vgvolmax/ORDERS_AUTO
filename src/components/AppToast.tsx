import { createPortal } from 'react-dom';

/** A shared notification lane stays above modal inert roots. */
export function AppToast({ message }: { message: string }) {
  return createPortal(
    <div className="toast" data-ui-toast role="status" aria-atomic="true">
      <span>{message}</span>
    </div>,
    document.body,
  );
}
