export function safeFilename(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[. ]+$/g, '') || 'Заказ'
  );
}

function trimSheetName(raw: string, limit: number): string {
  return raw.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '').replace(/[\s']+$/u, '');
}

function cleanSheetName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\[\]:*?/\\]/g, '').replace(/^[\s']+/u, '');
}

export function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = trimSheetName(cleanSheetName(raw), 31) || 'Лист';
  const taken = new Set(Array.from(used, (name) => name.toLowerCase()));
  taken.add('history');

  let candidate = base;
  let suffixNumber = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${suffixNumber})`;
    suffixNumber += 1;
    candidate = `${trimSheetName(base, 31 - suffix.length)}${suffix}`;
  }

  used.add(candidate);
  return candidate;
}

export function directedSheetName(
  from: string,
  to: string,
  used: Set<string>,
): string {
  const sideBudget = 31 - ' → '.length;
  const half = sideBudget / 2;
  const sender = trimSheetName(cleanSheetName(from), sideBudget) || 'Отправитель';
  const recipient = trimSheetName(cleanSheetName(to), sideBudget) || 'Получатель';
  const senderLabel = trimSheetName(
    sender,
    Math.max(half, sideBudget - recipient.length),
  );
  const recipientLabel = trimSheetName(
    recipient,
    Math.max(half, sideBudget - sender.length),
  );
  return uniqueSheetName(`${senderLabel} → ${recipientLabel}`, used);
}
