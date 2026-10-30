import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';

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
    sequence = useRef(0);
  committed.current = value;
  useEffect(() => {
    if (pending.current === 0) setDraft(String(value));
  }, [value]);
  function change(text: string) {
    setDraft(text);
    setError('');
    if (text === '') return;
    const qty = Number(text);
    if (!Number.isFinite(qty) || qty < 0) return;
    const current = ++sequence.current;
    pending.current++;
    setSaving(pending.current);
    const finish = (failed: boolean) => {
      pending.current--;
      setSaving(pending.current);
      if (failed && current === sequence.current) {
        setDraft(String(committed.current));
        setError(saveErrorMessage);
      }
    };
    try {
      const result = onCommit(qty);
      if (result && typeof result.then === 'function')
        void result.then(
          () => finish(false),
          () => finish(true),
        );
      else finish(false);
    } catch {
      finish(true);
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
        <small id={errorId} className="danger-text" role="alert">
          {error}
        </small>
      )}
    </>
  );
}
