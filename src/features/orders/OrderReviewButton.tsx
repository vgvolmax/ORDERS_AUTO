import { Button } from '../../components/ui';

export function OrderReviewButton({
  reviewed,
  label,
  disabled,
  onChange,
}: {
  reviewed: boolean;
  label: string;
  disabled: boolean;
  onChange: (reviewed: boolean) => void;
}) {
  return (
    <Button
      type="button"
      className="secondary review-toggle"
      role="switch"
      aria-label={label}
      aria-checked={reviewed}
      disabled={disabled}
      onClick={() => onChange(!reviewed)}
    >
      {reviewed ? 'Проверен' : 'Не проверен'}
    </Button>
  );
}
