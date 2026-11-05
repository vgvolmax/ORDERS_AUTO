import { useRef } from 'react';
import { BrandIcon, type BrandIconName } from './BrandIcon';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export function Button({
  className = '',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`button ${className}`} onClick={onClick} {...props} />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input" {...props} />;
}

export function MetricCard({
  label,
  value,
  note,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode | undefined;
  icon?: BrandIconName;
  tone?: 'neutral' | 'accent' | 'warning' | 'success';
}) {
  return (
    <div
      className="metric"
      data-tone={tone}
      data-icon={icon ? true : undefined}
    >
      {icon && <BrandIcon name={icon} />}
      <span>{label}</span>
      <strong>{value}</strong>
      {note != null && <small>{note}</small>}
    </div>
  );
}

export function Alert({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'danger' | undefined;
}) {
  return (
    <div
      className={`alert ${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function SearchInput({
  value,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="search-control">
      <BrandIcon name="search" />
      <input
        ref={ref}
        className="input"
        {...props}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Очистить поиск"
          title="Очистить поиск"
          onClick={(e) => {
            e.preventDefault();
            onValueChange('');
            ref.current?.focus();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
