const partyMarker = /(?:^|[\s,;])(?:(поставщик|продавец|исполнитель)|(покупатель|заказчик|плательщик|грузополучатель|грузоотправитель))(?:\s*\([^)]+\))?\s*:/giu;
const sellerInn = /(?<![а-яё])инн\s+(?:поставщика|продавца|исполнителя)(?:\s*\/\s*кпп)?\s*[:№]?\s*((?:\d{12}|\d{10}))(?!\d)/giu;
const innField = /(?<![а-яё])инн(?:\s*\/\s*кпп)?\s*[:№]?\s*((?:\d{12}|\d{10}))(?!\d)/giu;

export function readInvoiceIssuerInns(rows: readonly string[][]): string[] {
  const inns = new Set<string>();
  let sellerUntil = -1;
  for (const [index, cells] of rows.entries()) {
    const text = cells.map((cell) =>
      /^(?:поставщик|продавец|исполнитель|покупатель|заказчик|плательщик|грузополучатель|грузоотправитель)(?:\s*\([^)]+\))?$/iu.test(cell)
        ? cell + ':' : cell,
    ).join(' ');
    for (const match of text.matchAll(sellerInn)) inns.add(match[1]!);
    const markers = [...text.matchAll(partyMarker)];
    let start = 0;
    for (const marker of markers) {
      if (index <= sellerUntil) {
        for (const match of text.slice(start, marker.index).matchAll(innField)) inns.add(match[1]!);
      }
      sellerUntil = marker[1] ? index + 2 : -1;
      start = marker.index + marker[0].length;
    }
    if (index <= sellerUntil) {
      for (const match of text.slice(start).matchAll(innField)) inns.add(match[1]!);
    }
  }
  return [...inns];
}
