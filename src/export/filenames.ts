export function safeFilename(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[. ]+$/g, '') || 'Заказ'
  );
}

export function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\[\]:*?/\\]/g, '').trim() || 'Лист').slice(0, 31);
  let candidate = base;
  let suffixNumber = 2;

  while (used.has(candidate)) {
    const suffix = ` (${suffixNumber})`;
    suffixNumber += 1;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }

  used.add(candidate);
  return candidate;
}
