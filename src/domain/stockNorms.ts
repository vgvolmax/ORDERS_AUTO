/** Negative norms are invalid even when the other norm is missing or zero. */
export function hasNegativeStockNorm(min: number | null, max: number | null): boolean {
  return (min !== null && min < 0) || (max !== null && max < 0);
}
