import { useContext, useId, useLayoutEffect, useRef } from 'react';
import { StoreContext } from './appStore';

export function useAppBoxDraft(dirty: boolean, discard: () => void) {
  const key = useId();
  const setDraft = useContext(StoreContext)?.shared?.setDraft;
  const reset = useRef(discard);
  useLayoutEffect(() => { reset.current = discard; }, [discard]);
  useLayoutEffect(() => {
    if (!setDraft || !dirty) return;
    setDraft(key, () => reset.current());
    return () => setDraft(key);
  }, [dirty, key, setDraft]);
}
