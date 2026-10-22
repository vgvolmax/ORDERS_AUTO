import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Immediate editing feedback; the workspace remains the committed business state. */
export function useDurableDraft<T>(
  value: T,
  identity: string,
  write: (next: T) => Promise<void>,
): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const latest = useRef(value),
    owner = useRef(identity),
    pending = useRef(0),
    sequence = useRef(0);
  latest.current = value;
  owner.current = identity;
  useLayoutEffect(() => {
    pending.current = 0;
    sequence.current++;
    setDraft(value);
  }, [identity]);
  useEffect(() => {
    if (pending.current === 0) setDraft(value);
  }, [value]);
  function change(next: T) {
    const revision = ++sequence.current,
      generation = identity;
    pending.current++;
    setDraft(next);
    const finish = (failed: boolean) => {
      if (generation !== owner.current) return;
      pending.current--;
      if (failed && revision === sequence.current) setDraft(latest.current);
    };
    try {
      void write(next).then(
        () => finish(false),
        () => finish(true),
      );
    } catch {
      finish(true);
    }
  }
  return [draft, change];
}
