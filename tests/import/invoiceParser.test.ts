import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { InvoiceSheetsRequiredError, parseInvoiceWorkbook, selectInvoiceSheets } from '../../src/import/invoiceParser';
import { compareInvoice } from '../../src/domain/invoices';

function workbook(sheets: XLSX.WorkSheet[], bookType: 'xlsx' | 'biff8' = 'xlsx'): ArrayBuffer {
  const book = XLSX.utils.book_new();
  sheets.forEach((sheet, i) => XLSX.utils.book_append_sheet(book, sheet, 'Лист ' + (i + 1)));
  return XLSX.write(book, { type: 'array', bookType });
}

const sheet = XLSX.utils.aoa_to_sheet;

it('requires an explicit sheet choice instead of silently dropping or combining invoice sheets', () => {
  const header = ['Код 1С', 'Артикул', 'Количество', 'Ед.', 'Цена', 'Сумма'];
  const bytes = workbook([
    sheet([header, ['0001', '000123', 4, 'шт', 100, 400]]),
    sheet([header, ['0001', '000123', 6, 'шт', 100, 600]]),
  ]);
  expect(() => parseInvoiceWorkbook(bytes)).toThrow(/выберите.*листы/i);
  let choice: InvoiceSheetsRequiredError | undefined;
  try { parseInvoiceWorkbook(bytes); } catch (error) {
    expect(error).toBeInstanceOf(InvoiceSheetsRequiredError);
    choice = error as InvoiceSheetsRequiredError;
  }
  const result = selectInvoiceSheets(choice!.sheets, ['Лист 1', 'Лист 2']);
  expect(result.items).toMatchObject([
    { quantity: 4, sourceRow: 2, sourceSheet: 'Лист 1' },
    { quantity: 6, sourceRow: 2, sourceSheet: 'Лист 2' },
  ]);
  expect(compareInvoice([], result.items)).toMatchObject([{ invoiceQty: 10, invoiceAmount: 1000 }]);
  const firstOnly = selectInvoiceSheets(choice!.sheets, ['Лист 1']);
  expect(firstOnly.items.map(({ quantity }) => quantity)).toEqual([4]);
  expect(firstOnly.warnings.join(' ')).toMatch(/не включены.*Лист 2/i);
  expect(() => selectInvoiceSheets(choice!.sheets, [])).toThrow(/лист/i);
  expect(() => selectInvoiceSheets(choice!.sheets, ['Удалённый лист'])).toThrow(/лист/i);
  expect(selectInvoiceSheets(choice!.sheets, ['Лист 1', 'Лист 1']).items).toHaveLength(1);
});

it('keeps invoice rows on different sheets distinguishable when physical row numbers repeat', () => {
  const parsed = selectInvoiceSheets([
    { name: 'Первая', ...parseInvoiceWorkbook(workbook([sheet([
      ['Артикул', 'Количество', 'Ед.', 'Цена'], ['LEFT', 4, 'шт', 100],
    ])])) },
    { name: 'Вторая', ...parseInvoiceWorkbook(workbook([sheet([
      ['Артикул', 'Количество', 'Ед.', 'Цена'], ['RIGHT', 6, 'шт', 100],
    ])])) },
  ], ['Первая', 'Вторая']);
  const rows = compareInvoice([], parsed.items);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map(({ id }) => id)).size).toBe(2);
});

it('finds every fixed-layout invoice sheet before requiring a choice', () => {
  const row: unknown[] = [];
  row[8] = 'B-7'; row[12] = 'Крепёж'; row[40] = 2; row[46] = 'шт'; row[47] = 3; row[67] = 6;
  expect(() => parseInvoiceWorkbook(workbook([sheet([['Счёт'], row]), sheet([['Счёт'], row])]))).toThrow(/выберите.*листы/i);
});

it.each(['Ед. измерения', 'Ед. изм.', 'Единица измерения', 'Единицы изм.', 'Ед. измер.', 'Единица измер.', 'Единицы измер.'])(
  'recognizes the invoice unit column %s without assuming pieces', (unitHeader) => {
    const result = parseInvoiceWorkbook(workbook([sheet([
      ['Артикул', 'Количество', unitHeader, 'Цена', 'Сумма'],
      ['A-123', 10, 'упак', 100, 1000],
    ])]));
    expect(result.items[0]?.unit).toBe('упак');
  },
);

it('does not hide a recognized invoice part when its quantities cannot be read', () => {
  const header = ['Артикул', 'Количество', 'Ед.', 'Цена'];
  const bytes = workbook([
    sheet([header, ['A-123', 4, 'шт', 100]]),
    sheet([header, ['B-456', 'ошибка', 'шт', 100]]),
  ]);
  expect(() => parseInvoiceWorkbook(bytes)).toThrow(/выберите.*листы/i);
  try { parseInvoiceWorkbook(bytes); } catch (error) {
    const sheets = (error as InvoiceSheetsRequiredError).sheets;
    expect(sheets).toHaveLength(2);
    expect(sheets[1]?.items).toEqual([]);
    expect(sheets[1]?.warnings.join(' ')).toMatch(/строке 2.*количество/i);
    const selected = selectInvoiceSheets(sheets, ['Лист 1']);
    expect(selected.items[0]?.quantity).toBe(4);
    expect(selected.warnings.join(' ')).toMatch(/Лист 2.*количество/i);
    expect(() => selectInvoiceSheets(sheets, ['Лист 2'])).toThrow(/нет.*позиц/i);
  }
});

describe('parseInvoiceWorkbook', () => {
  it('uses the first recognized sheet, discount columns and physical row numbers around repeated headers', () => {
    const header = ['Код 1С', 'Артикул', 'Наименование', 'Количество', 'Ед.', 'Цена без скидки', 'Цена со скидкой', 'Сумма без скидки', 'Сумма со скидкой', 'Сумма НДС'];
    const products = sheet([
      [7, '001A', 'Товар', '1 234,5', 'шт.', 100, 90, 123450, 111104.99, 18517.5],
      [], header, [null, 'П-2', 'Другой', 'отсутствует', 'шт.', 3, 2, 3, 2],
      header, [8, 'П-3', 'Ещё', 2, 'шт.', 200, 180, 400, 360, 60],
      ['Итого', null, null, 2, null, null, null, null, 360],
    ]);
    products.A1!.z = '0000';

    const result = parseInvoiceWorkbook(workbook([sheet([['Заметки']]), products]));
    expect(result.items).toEqual([
      { skuCode: '0007', article: '001A', name: 'Товар', quantity: 1234.5, unit: 'шт.', price: 90, amount: 111104.99, sourceRow: 1 },
      { skuCode: '8', article: 'П-3', name: 'Ещё', quantity: 2, unit: 'шт.', price: 180, amount: 360, sourceRow: 6 },
    ]);
    expect(result.warnings).toEqual([expect.stringMatching(/строк[ае] 4.*количеств/i)]);
  });

  it('reads BIFF8 and does not infer a code from the supplier’s generic code column', () => {
    const products = sheet([
      ['Код', 'Артикул', 'Кол-во', 'Цена', 'Сумма'],
      ['D1', 'B-7', 2, 3, 5.99],
    ]);
    expect(parseInvoiceWorkbook(workbook([products], 'biff8')).items[0]).toMatchObject({
      skuCode: null, article: 'B-7', quantity: 2, price: 3, amount: 5.99,
    });
  });

  it('imports a populated sheet after an empty sheet with ambiguous headers', () => {
    const empty = sheet([['Артикул', 'Количество', 'Количество', 'Цена']]);
    const products = sheet([
      ['Артикул', 'Количество', 'Цена'],
      ['B-7', 2, 10],
    ]);

    expect(parseInvoiceWorkbook(workbook([empty, products])).items).toMatchObject([
      { article: 'B-7', quantity: 2, price: 10, sourceRow: 2 },
    ]);
  });

  it('uses the fixed supplier template when a product line confirms its column layout', () => {
    const product: unknown[] = [];
    product[8] = 'B-7';
    product[12] = 'Крепёж';
    product[40] = 2;
    product[46] = 'шт';
    product[47] = 3;
    product[67] = 5.99;
    const result = parseInvoiceWorkbook(workbook([sheet([['Счёт'], product])]));

    expect(result.items[0]).toMatchObject({ article: 'B-7', quantity: 2, price: 3, amount: 5.99, sourceRow: 2 });
    expect(result.warnings).toEqual([expect.stringContaining('I')]);
  });

  it('rejects a workbook with no defensible invoice layout', () => {
    expect(() => parseInvoiceWorkbook(workbook([sheet([['Общий отчёт', 4]])]))).toThrow(/сч[её]та/i);
  });

  it('retains a recognized quantity with no price and reports the missing cost', () => {
    const products = sheet([
      ['Артикул', 'Количество', 'Цена', 'Сумма'],
      ['B-7', 2, 'н/д', null],
    ]);
    const result = parseInvoiceWorkbook(workbook([products]));
    expect(result.items[0]).toMatchObject({ quantity: 2, price: null, amount: null });
    expect(result.warnings).toEqual([expect.stringMatching(/строк[ае] 2.*цен/i)]);
  });
});

it('uses the final gross price and total ahead of net, pre-discount and VAT columns', () => {
  const products = sheet([
    ['Артикул', 'Количество', 'Цена без НДС', 'Цена с НДС', 'Цена без скидки', 'Цена со скидкой с НДС', 'Сумма скидки', 'Сумма НДС', 'Сумма со скидкой с НДС'],
    ['B-7', 2, 3, 3.6, 4, 3.5, 1, 1.17, 6.99],
  ]);
  expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({ price: 3.5, amount: 6.99 });
});

it('does not treat a discount or VAT column as the line total', () => {
  const products = sheet([
    ['Артикул', 'Количество', 'Цена с НДС', 'Сумма скидки', 'Сумма НДС'],
    ['B-7', 2, 3.6, 1, 1.2],
  ]);
  expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({ price: 3.6, amount: null });
});

it('uses net values only when the invoice presents them as the only unit price and line total', () => {
  const products = sheet([
    ['Артикул', 'Количество', 'Цена без НДС', 'Сумма без НДС', 'Сумма НДС'],
    ['B-7', 2, 3.1, 6.19, 1.2],
  ]);
  expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({ price: 3.1, amount: 6.19 });
});

it.each(['Итого НДС', 'Всего НДС', 'Итого скидка', 'Сумма в т.ч. НДС'])(
  'does not treat %s as a payable total',
  (taxOrDiscount) => {
    const products = sheet([
      ['Артикул', 'Количество', 'Цена с НДС', taxOrDiscount],
      ['B-7', 2, 120, 40],
    ]);
    expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({ price: 120, amount: null });
  },
);

it('does not retain the pre-discount sum when the price is after discount', () => {
  const products = sheet([
    ['Артикул', 'Количество', 'Цена со скидкой', 'Сумма до скидки'],
    ['B-7', 2, 90, 200],
  ]);
  expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({ price: 90, amount: null });
});

it('prefers item quantity over the number of packages regardless of column order', () => {
  const products = sheet([
    ['Артикул', 'Количество упаковок', 'Количество', 'Ед.', 'Цена', 'Сумма'],
    ['B-7', 2, 20, 'шт', 10, 200],
  ]);
  expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({
    quantity: 20, unit: 'шт', price: 10, amount: 200,
  });
});

it('prefers the total including VAT over a generic subtotal and does not retain the net unit price', () => {
  const products = sheet([
    ['Артикул', 'Количество', 'Цена без НДС', 'Сумма', 'НДС', 'Всего с учётом НДС'],
    ['B-7', 2, 10, 20, 4, 24],
  ]);
  expect(parseInvoiceWorkbook(workbook([products])).items[0]).toMatchObject({
    quantity: 2, price: null, amount: 24,
  });
});

it('refuses equally plausible quantity columns and identifies them for the operator', () => {
  const products = sheet([
    ['Артикул', 'Количество', 'Количество', 'Цена'],
    ['B-7', 2, 20, 10],
  ]);
  expect(() => parseInvoiceWorkbook(workbook([products]))).toThrow(/количество.*B.*C/i);
});
