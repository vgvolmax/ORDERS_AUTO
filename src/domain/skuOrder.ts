const naturalSkuOrder = new Intl.Collator('ru-RU', {
  numeric: true,
  sensitivity: 'base',
});

export function buildSkuOrder(
  codes: readonly string[],
): (left: string, right: string) => number {
  const sourceRank = new Map<string, number>();
  codes.forEach((code, index) => {
    if (!sourceRank.has(code)) sourceRank.set(code, index);
  });
  const unknownRank = codes.length;

  return (left, right) => {
    const leftRank = sourceRank.get(left) ?? unknownRank;
    const rightRank = sourceRank.get(right) ?? unknownRank;
    return (
      leftRank - rightRank ||
      naturalSkuOrder.compare(left, right) ||
      (left < right ? -1 : left > right ? 1 : 0)
    );
  };
}
