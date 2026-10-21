/** Exact decimal arithmetic for step capacities and strict monetary boundaries. */
interface Decimal { n: bigint; d: bigint }
function decimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new RangeError('Неконечное число');
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  const parts = mantissa!.split('.');
  const scale = (parts[1]?.length ?? 0) - Number(exponent);
  const n = BigInt(parts.join(''));
  return scale >= 0 ? { n, d: 10n ** BigInt(scale) } : { n: n * 10n ** BigInt(-scale), d: 1n };
}
function add(a: Decimal, b: Decimal): Decimal {
  const d = a.d > b.d ? a.d : b.d;
  return { n: a.n * (d / a.d) + b.n * (d / b.d), d };
}
function number(a: Decimal): number {
  return Number(`${a.n}e-${a.d.toString().length - 1}`);
}
export function sumQuantities(values: Iterable<number>): number {
  let result: Decimal = { n: 0n, d: 1n };
  for (const value of values) result = add(result, decimal(value));
  return number(result);
}
/** Common exact decimal scale for comparing physical coverage without floating-point costs. */
export function integerWeights(values: readonly number[]): bigint[] {
  const parts = values.map(decimal);
  const scale = parts.reduce((largest, value) => largest > value.d ? largest : value.d, 1n);
  return parts.map((value) => value.n * (scale / value.d));
}
export const subtractQuantity = (a: number, b: number): number => sumQuantities([a, -b]);
export function stepUnits(qty: number, step: number, rounding: 'floor' | 'ceil' = 'floor'): number {
  const a = decimal(qty), b = decimal(step);
  if (a.n < 0 || b.n <= 0) throw new RangeError('Некорректная ёмкость или шаг');
  const numerator = a.n * b.d, denominator = a.d * b.n;
  const value = rounding === 'ceil' ? (numerator + denominator - 1n) / denominator : numerator / denominator;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Количество шагов превышает безопасную точность');
  return Number(value);
}
export function quantityFromUnits(units: number, step: number): number {
  const d = decimal(step);
  if (!Number.isSafeInteger(units) || units < 0) throw new RangeError('Некорректное количество шагов');
  return number({ n: BigInt(units) * d.n, d: d.d });
}
export function isStepQuantity(qty: number, step: number): boolean {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(step) || step <= 0) return false;
  const a = decimal(qty), b = decimal(step);
  const n = a.n * b.d, d = a.d * b.n;
  return n % d === 0n && n / d <= BigInt(Number.MAX_SAFE_INTEGER);
}
/** Absolute stock ceiling; callers round the transferable delta to the quantity step. */
export function receiverTarget(min: number, max: number, pct: number): number {
  const base = decimal(min), width = decimal(subtractQuantity(max, min)), percent = decimal(pct);
  return number(add(base, { n: width.n * percent.n, d: width.d * percent.d * 100n }));
}
export function moneyGreaterThan(qty: number, price: number, threshold: number): boolean {
  const q = decimal(qty), p = decimal(price), t = decimal(threshold);
  return q.n * p.n * t.d > t.n * q.d * p.d;
}
