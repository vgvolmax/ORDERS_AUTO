export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeKey(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase('ru-RU');
}

export function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const parsed = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStockNumber(value: unknown): number {
  return parseOptionalNumber(value) ?? 0;
}
