/** Finite Number inputs interpreted by their full decimal string, without epsilon. */
export interface Decimal {
  n: bigint;
  d: bigint;
}

export function decimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new RangeError('Неконечное число');
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  const parts = mantissa!.split('.');
  const scale = (parts[1]?.length ?? 0) - Number(exponent);
  const n = BigInt(parts.join(''));
  return scale >= 0
    ? { n, d: 10n ** BigInt(scale) }
    : { n: n * 10n ** BigInt(-scale), d: 1n };
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const d = a.d > b.d ? a.d : b.d;
  return { n: a.n * (d / a.d) + b.n * (d / b.d), d };
}

export function decimalNumber(a: Decimal): number {
  return Number(`${a.n}e-${a.d.toString().length - 1}`);
}

export function sumDecimals(values: Iterable<number>): Decimal {
  let result: Decimal = { n: 0n, d: 1n };
  for (const value of values) result = addDecimal(result, decimal(value));
  return result;
}

export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { n: a.n * b.n, d: a.d * b.d };
}
