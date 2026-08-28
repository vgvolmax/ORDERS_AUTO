import type { StockStatus } from '../domain/types';

export const stockStatusLabels: Record<StockStatus, string> = {
  NO_NORM: 'Нет норматива',
  OK: 'На MAX',
  YELLOW: 'Дефицит до 25%',
  ORANGE: 'Дефицит 25–75%',
  LIGHT_RED: 'Дефицит 75–100%',
  BELOW_MIN: 'Ниже MIN',
  INVALID_NORM: 'Ошибка норматива',
};

export function StatusBadge({ status }: { status: StockStatus }) {
  return <span className={`badge ${status}`}>{stockStatusLabels[status]}</span>;
}
