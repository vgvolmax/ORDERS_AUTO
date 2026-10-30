import { fmtQty } from '../format/numbers';

interface QuantityRow {
  skuCode: string;
  qty: number;
  unit: string | null;
}

/** Presentation only: quantities from incompatible or unknown units never mix. */
export function QuantitySummary({ rows }: { rows: readonly QuantityRow[] }) {
  const units = new Map<string, number>();
  const unknown = new Set<string>();
  if (rows.some((row) => !Number.isFinite(row.qty) || row.qty < 0))
    return <span>Количество неизвестно</span>;
  for (const row of rows) {
    if (row.qty === 0) continue;
    const unit = row.unit?.trim();
    if (!unit) {
      unknown.add(row.skuCode);
      continue;
    }
    units.set(unit, (units.get(unit) ?? 0) + row.qty);
  }
  const parts = [...units].map(([unit, qty]) =>
    Number.isFinite(qty)
      ? `${fmtQty(qty)} ${unit}`
      : `Количество неизвестно (${unit})`,
  );
  if (unknown.size) parts.push(`Без единицы: ${unknown.size} SKU`);
  return (
    <span className="quantity-summary">
      {parts.length ? parts.join(' · ') : '0'}
    </span>
  );
}
