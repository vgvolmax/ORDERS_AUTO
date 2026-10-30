import { useLayoutEffect, useRef } from 'react';

/** Route positions belong to the current workspace, never to an overlay. */
export function usePageScroll(page: string, workspaceId: string, enabled: boolean) {
  const positions = useRef(new Map<string, number>());
  const workspace = useRef(workspaceId);
  useLayoutEffect(() => {
    if (!enabled) return;
    if (workspace.current !== workspaceId) {
      positions.current.clear();
      workspace.current = workspaceId;
    }
    window.scrollTo({ top: positions.current.get(page) ?? 0, behavior: 'instant' });
    const remember = () => positions.current.set(page, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [page, workspaceId, enabled]);
}
