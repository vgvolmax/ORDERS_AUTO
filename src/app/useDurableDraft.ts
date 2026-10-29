import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Immediate editing feedback; the workspace remains the committed business state. */
export function useDurableDraft<T>(
  value: T,
  identity: string,
  write: (next: T) => Promise<void>,
): [T, (next: T) => Promise<void>] {
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
    let operation: Promise<void>;
    try {
      operation = write(next);
    } catch (error) {
      operation = Promise.reject(error);
    }
    // Keep ignored event-handler calls safe, while allowing fields that own
    // their local text draft to observe the original save failure as well.
    void operation.then(
      () => finish(false),
      () => finish(true),
    );
    return operation;
  }
  return [draft, change];
}
