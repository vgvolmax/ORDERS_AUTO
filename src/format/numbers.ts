const moneyFormat = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});
const quantityFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 12 });
const tinyQuantityFormat = new Intl.NumberFormat('ru-RU', {
  notation: 'scientific',
  maximumSignificantDigits: 15,
});

export function money(value: number): string {
  return moneyFormat.format(value);
}

export function fmtQty(value: number): string {
  return (value !== 0 && Math.abs(value) < 1e-9 ? tinyQuantityFormat : quantityFormat).format(value);
}
