import * as XLSX from 'xlsx';
import type { InvoiceItem } from '../domain/invoices';
import { normalizeKey, normalizeText, parseOptionalNumber } from '../domain/normalize';

type Cells = Map<number, XLSX.CellObject>;
type SheetRows = Array<[number, Cells]>;

interface Header {
  code: number;
  article: number;
  name: number;
  quantity: number;
  unit: number;
  price: number;
  amount: number;
}

interface ParsedInvoice {
  items: InvoiceItem[];
  warnings: string[];
}

class AmbiguousInvoiceHeaderError extends Error {}

const FIXED_HEADER: Header = {
  code: -1, article: 8, name: 12, quantity: 40, unit: 46, price: 47, amount: 67,
};
const CODE_HEADERS = new Set(['код1с', 'код1c', 'кодноменклатуры1с', 'кодноменклатуры1c']);
const FIXED_LAYOUT_WARNING = 'Колонки счёта определены по шаблону поставщика: артикул — I, количество — AO, цена — AV.';

function compact(value: unknown): string {
  return normalizeKey(value).replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

function sheetRows(sheet: XLSX.WorkSheet): SheetRows {
  const rows = new Map<number, Cells>();
  for (const [address, cell] of Object.entries(sheet)) {
    if (!/^[A-Z]+[1-9][0-9]*$/.test(address) || cell.t === 'z') continue;
    const { r, c } = XLSX.utils.decode_cell(address);
    let row = rows.get(r);
    if (!row) {
      row = new Map<number, XLSX.CellObject>();
      rows.set(r, row);
    }
    row.set(c, cell);
  }
  return [...rows].sort(([left], [right]) => left - right);
}

function findHeader(cells: Cells): Header | null {
  const entries = [...cells].sort(([a], [b]) => a - b).map(([column, cell]) => [column, compact(cell.v)] as const);
  const find = (predicate: (label: string, column: number) => boolean): number =>
    entries.find(([column, label]) => predicate(label, column))?.[0] ?? -1;

  const code = find((label) => CODE_HEADERS.has(label));
  const article = find((label) => label.startsWith('артикул'));
  if (code < 0 && article < 0) return null;

  const quantityHeader = (label: string): boolean => /^(колич|колво)|^(кол|qty|quantity)$/.test(label);
  const quantityRank = (label: string): number => {
    if (/^(?:количество|колво|кол|qty|quantity)$/.test(label)) return 0;
    return /упак|короб|палет|поддон|количествомест|колвомест/.test(label) ? 2 : 1;
  };
  const priceHeader = (label: string): boolean => label.startsWith('цена');
  const amountHeader = (label: string): boolean => {
    const suffix = label.replace(/^(?:сумма|стоимость|стоим|итого|всего)/, '');
    return suffix !== label && !/^(?:итого|всего|втч|втомчисле)*(?:ндс|налог|скид)/.test(suffix);
  };
  const net = (label: string): boolean => /без(?:учета)?(?:ндс|налога)/.test(label);
  const gross = (label: string): boolean => /с(?:учетом|включением)?(?:ндс|налогом)|включаяндс/.test(label);
  const beforeDiscount = (label: string): boolean => /(?:без|до)скид/.test(label);
  const moneyRank = (label: string): number => {
    const discount = /соскид|послескид|учетомскид/.test(label) ? 0 : beforeDiscount(label) ? 2 : 1;
    return (net(label) ? 6 : 0) + discount * 2 + (gross(label) ? 0 : 1);
  };
  const preferred = (predicate: (label: string) => boolean, rank: (label: string) => number) => {
    const candidates = entries.filter(([, label]) => predicate(label));
    const bestRank = Math.min(...candidates.map(([, label]) => rank(label)));
    return candidates.filter(([, label]) => rank(label) === bestRank);
  };
  const quantities = preferred(quantityHeader, quantityRank);
  const prices = preferred(priceHeader, moneyRank);
  const amounts = preferred(amountHeader, moneyRank);
  if (!quantities.length || (!prices.length && !amounts.length)) return null;

  const selected = (candidates: typeof entries, field: string) => {
    if (candidates.length > 1) {
      const columns = candidates.map(([column]) => XLSX.utils.encode_col(column)).join(', ');
      throw new AmbiguousInvoiceHeaderError(`Не удалось однозначно определить поле «${field}» в счёте. Проверьте колонки ${columns} и оставьте одну подходящую колонку.`);
    }
    return candidates[0];
  };
  const quantity = selected(quantities, 'Количество')![0];
  let priceEntry = prices[0];
  let amountEntry = amounts[0];
  if (priceEntry && amountEntry) {
    const priceLabel = priceEntry[1];
    const amountLabel = amountEntry[1];
    // An amount on a different tax or discount basis is not the exact total
    // for the chosen price. Keep the payable basis and derive the other value.
    if (net(priceLabel) !== net(amountLabel)) {
      if (net(priceLabel)) priceEntry = undefined;
      else amountEntry = undefined;
    } else if (beforeDiscount(priceLabel) !== beforeDiscount(amountLabel)) {
      if (beforeDiscount(priceLabel)) priceEntry = undefined;
      else amountEntry = undefined;
    }
  }
  const price = priceEntry ? selected(prices, 'Цена')![0] : -1;
  const amount = amountEntry ? selected(amounts, 'Сумма')![0] : -1;

  return {
    code,
    article,
    name: find((label) => /^(товар|номенклат|наименование)/.test(label)),
    quantity,
    unit: find((label) => /^(ед|единица|единицы|едизм|единицаизмерения|единицыизмерения|unit)$/.test(label)),
    price,
    amount,
  };
}

function identifier(cell: XLSX.CellObject | undefined): string {
  if (cell?.t !== 'n') return cell?.t === 'e' ? '' : normalizeText(cell?.v);
  const value = Number(cell.v);
  const mask = typeof cell.z === 'string' ? cell.z : '';
  // Number formatting can round or use scientific notation. Pure zero masks
  // are the only format that changes how a numeric identifier should be read.
  return /^0+$/.test(mask) && Number.isSafeInteger(value) && value >= 0
    ? String(value).padStart(mask.length, '0')
    : String(value);
}

function invoiceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = normalizeText(value)
    .replace(/[−–—]/g, '-')
    .replace(/\s*(?:₽|руб(?:лей|ля)?\.?|р\.|шт\.?)$/iu, '')
    .trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d+)?$/.test(text)) {
    const grouped = /^([+-]?\d{1,3}([,.])\d{3}(?:\2\d{3})*)([,.])(\d+)$/.exec(text);
    if (!grouped) return null;
    const [, integer, separator, decimalSeparator, decimals] = grouped;
    if (separator === decimalSeparator) return null;
    return parseOptionalNumber(integer!.replaceAll(separator!, '') + '.' + decimals);
  }
  return parseOptionalNumber(text);
}

function isSummary(value: unknown): boolean {
  return /^(?:итого|всего|в том числе|без налога|к оплате|сумма прописью|ндс|подпись|руководитель|главный бухгалтер)(?:[\s:.,]|$)/iu
    .test(normalizeText(value));
}

function parseRows(rows: SheetRows, initialHeader: Header, useFixedLayout: boolean): ParsedInvoice {
  const items: InvoiceItem[] = [];
  const warnings: string[] = useFixedLayout ? [FIXED_LAYOUT_WARNING] : [];
  let header = initialHeader;
  for (const [rowIndex, cells] of rows) {
    const repeatedHeader = useFixedLayout ? null : findHeader(cells);
    if (repeatedHeader) {
      header = repeatedHeader;
      continue;
    }
    const row = rowIndex + 1;
    const code = identifier(cells.get(header.code));
    const article = identifier(cells.get(header.article));
    const name = normalizeText(cells.get(header.name)?.v);
    const unit = normalizeText(cells.get(header.unit)?.v);
    if (isSummary(code) || isSummary(article) || (!article && !code && isSummary(name))) continue;
    if (compact(article) === 'артикул' || CODE_HEADERS.has(compact(code))) continue;

    const quantityCell = cells.get(header.quantity);
    const priceCell = cells.get(header.price);
    const amountCell = cells.get(header.amount);
    const quantity = quantityCell?.t === 'e' ? null : invoiceNumber(quantityCell?.v);
    const price = priceCell?.t === 'e' ? null : invoiceNumber(priceCell?.v);
    const amount = amountCell?.t === 'e' ? null : invoiceNumber(amountCell?.v);
    if (!article && !code) {
      if (name && (quantityCell || priceCell || amountCell)) {
        warnings.push(`В строке ${row} счёта отсутствуют артикул и Код 1С. Строка пропущена.`);
      }
      continue;
    }
    if (quantity === null) {
      warnings.push(`В строке ${row} счёта не удалось прочитать количество. Строка пропущена.`);
      continue;
    }

    if (price === null && amount === null) {
      warnings.push(`В строке ${row} счёта не указаны числовые цена и сумма.`);
    } else if ((price === null && priceCell?.v != null) || (amount === null && amountCell?.v != null)) {
      warnings.push(`В строке ${row} счёта не удалось прочитать цену или сумму.`);
    }
    items.push({ skuCode: code || null, article, name, quantity, unit: unit || null, price, amount, sourceRow: row });
  }
  return { items, warnings };
}

function hasFixedLayout(rows: SheetRows): boolean {
  return rows.some(([, cells]) => {
    const article = identifier(cells.get(FIXED_HEADER.article));
    const name = normalizeText(cells.get(FIXED_HEADER.name)?.v);
    const unit = normalizeText(cells.get(FIXED_HEADER.unit)?.v);
    const quantity = invoiceNumber(cells.get(FIXED_HEADER.quantity)?.v);
    const price = invoiceNumber(cells.get(FIXED_HEADER.price)?.v);
    const amount = invoiceNumber(cells.get(FIXED_HEADER.amount)?.v);
    return Boolean(article && name && !isSummary(article) && quantity !== null &&
      (price !== null || amount !== null) && (unit || (price !== null && amount !== null)));
  });
}

export function parseInvoiceWorkbook(bytes: ArrayBuffer): ParsedInvoice {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true });
  } catch {
    throw new Error('Не удалось открыть файл счёта. Проверьте, что это корректный файл Excel (.xlsx или .xls).');
  }

  let firstRows: SheetRows = [];
  let firstEmptyResult: ParsedInvoice | null = null;
  for (const [index, name] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = sheetRows(sheet);
    if (index === 0) firstRows = rows;

    let header: Header | null = null;
    for (const [rowIndex, cells] of rows) {
      try {
        header = findHeader(cells);
      } catch (error) {
        if (!(error instanceof AmbiguousInvoiceHeaderError)) throw error;
        const hasOtherRows = rows.some(([index, rowCells]) =>
          index !== rowIndex && [...rowCells.values()].some((cell) => normalizeText(cell.v)));
        if (hasOtherRows) throw error;
      }
      if (header) break;
    }
    if (!header) continue;
    const result = parseRows(rows, header, false);
    if (result.items.length > 0) return result;
    firstEmptyResult ??= result;
  }

  if (hasFixedLayout(firstRows)) {
    const result = parseRows(firstRows, FIXED_HEADER, true);
    if (result.items.length > 0) return result;
  }

  if (firstEmptyResult) {
    const detail = firstEmptyResult.warnings[0];
    throw new Error('В файле счёта не найдено ни одной товарной строки с числовым количеством.' + (detail ? ' ' + detail : ''));
  }
  throw new Error('Не удалось определить колонки счёта. Нужны артикул или Код 1С, количество и цена или сумма.');
}
