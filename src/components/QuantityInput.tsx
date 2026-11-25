import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import { WorkspaceConflictError } from '../domain/workspace';

/** Local typing draft; committed quantities still belong to the workspace queue. */
export function QuantityInput({
  value,
  onCommit,
  className = '',
  step = 'any',
  saveErrorMessage = 'Количество не сохранено. Повторите ввод.',
  invalidValueMessage = 'Введите неотрицательное количество.',
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> & {
  value: number;
  onCommit: (qty: number) => void | Promise<void>;
  saveErrorMessage?: string;
  invalidValueMessage?: string;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState(String(value)),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(0);
  const committed = useRef(value),
    pending = useRef(0),
    sequence = useRef(0),
    rejectedDraft = useRef<{ previousValue: number; savedQuantity?: number | undefined } | null>(null);
  committed.current = value;
  useEffect(() => {
    if (pending.current === 0 && !rejectedDraft.current) setDraft(String(value));
  }, [value]);
  function change(text: string) {
    rejectedDraft.current = null;
    setDraft(text);
    setError('');
    if (text === '') return;
    const qty = Number(text);
    if (!Number.isFinite(qty) || qty < 0) return;
    const current = ++sequence.current;
    pending.current++;
    setSaving(pending.current);
    const finish = (outcome: 'saved' | 'failed', reason?: unknown) => {
      pending.current--;
      setSaving(pending.current);
      if (outcome === 'failed' && current === sequence.current) {
        rejectedDraft.current = reason instanceof WorkspaceConflictError
          ? { previousValue: committed.current, savedQuantity: reason.savedQuantity }
          : null;
        if (!rejectedDraft.current) setDraft(String(committed.current));
        setError(reason instanceof WorkspaceConflictError ? reason.message : saveErrorMessage);
      }
    };
    try {
      const result = onCommit(qty);
      if (result && typeof result.then === 'function')
        void result.then(
          () => finish('saved'),
          (error) => finish('failed', error),
        );
      else finish('saved');
    } catch (error) {
      finish('failed', error);
    }
  }
  return (
    <>
      <input
        {...props}
        className={`input ${className}`}
        type="number"
        min="0"
        step={step}
        value={draft}
        aria-busy={saving > 0}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [props['aria-describedby'], error ? errorId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onChange={(e) => change(e.target.value)}
        onBlur={(e) => {
          props.onBlur?.(e);
          if (
            draft === '' ||
            !Number.isFinite(Number(draft)) ||
            Number(draft) < 0
          ) {
            setDraft(String(committed.current));
            setError(invalidValueMessage);
          }
        }}
      />
      {error && (
        <>
          <small id={errorId} className="danger-text" role="alert">
            {error}
          </small>
          {rejectedDraft.current && (
            <button type="button" className="link" onClick={() => {
              const conflict = rejectedDraft.current;
              const saved = conflict?.previousValue === committed.current
                ? conflict.savedQuantity ?? committed.current
                : committed.current;
              rejectedDraft.current = null;
              setDraft(String(saved));
              setError('');
            }}>
              Принять сохранённое
            </button>
          )}
        </>
      )}
    </>
  );
}
