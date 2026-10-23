import type { DonorSplitMode } from './types';

/** Integer step units throughout. Capped equal shares and exact largest remainders. */
export function splitAllocation(
  capacity: number,
  recipients: Array<{ id: string; need: number }>,
  mode: DonorSplitMode,
): Map<string, number> {
  const rows = recipients
    .filter((r) => r.need > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const result = new Map(rows.map((r) => [r.id, 0]));
  const totalNeed = rows.reduce((n, r) => n + BigInt(r.need), 0n);
  let remaining = BigInt(capacity) < totalNeed ? BigInt(capacity) : totalNeed;
  if (mode === 'PROPORTIONAL') {
    if (!totalNeed) return result;
    const fractions = rows
      .map((r) => {
        const numerator = remaining * BigInt(r.need);
        result.set(r.id, Number(numerator / totalNeed));
        return { id: r.id, remainder: numerator % totalNeed };
      })
      .sort((a, b) =>
        a.remainder > b.remainder
          ? -1
          : a.remainder < b.remainder
            ? 1
            : a.id < b.id
              ? -1
              : 1,
      );
    let extra = Number(
      remaining - [...result.values()].reduce((n, v) => n + BigInt(v), 0n),
    );
    for (const r of fractions)
      if (extra-- > 0) result.set(r.id, result.get(r.id)! + 1);
    return result;
  }
  let active = rows;
  while (active.length && remaining > 0n) {
    const share = remaining / BigInt(active.length);
    const capped = active.filter((r) => BigInt(r.need) <= share);
    if (capped.length) {
      for (const r of capped) {
        result.set(r.id, r.need);
        remaining -= BigInt(r.need);
      }
      const done = new Set(capped.map((r) => r.id));
      active = active.filter((r) => !done.has(r.id));
    } else {
      let extra = Number(remaining % BigInt(active.length));
      for (const r of active)
        result.set(r.id, Number(share) + (extra-- > 0 ? 1 : 0));
      remaining = 0n;
    }
  }
  return result;
}
