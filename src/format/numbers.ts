export function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(value);
}

export function fmtQty(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 12,
    ...(value !== 0 && Math.abs(value) < 1e-9
      ? { notation: 'scientific' as const, maximumSignificantDigits: 15 }
      : {}),
  }).format(value);
}
