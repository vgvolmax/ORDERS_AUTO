import * as XLSX from 'xlsx';

export function buildWorkbook(
  rows: unknown[][],
  bookType: 'xls' | 'xlsx' = 'xlsx',
): ArrayBuffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'TDSheet');
  return XLSX.write(workbook, { type: 'array', bookType });
}

export function buildMinMaxFixture(): ArrayBuffer {
  return buildWorkbook([
    [
      'Код',
      'Артикул',
      'Номенклатура',
      'Количество (в еденицах хранения)',
      'Минимальный остаток',
      'Максимальный остаток',
      'Цена',
    ],
    ['GROUP', null, 'Группа товаров', 999, null, 999, 100],
    ['SKU1', 'A-1', 'Товар 1', 4, 2, 8, 100],
    [null, null, 'Ленина', 3, 2, 8, null],
    [null, null, 'Ступино', ' ', 2, 8, null],
    ['SKU2', null, 'Товар 2', 1, 5, 4, ' '],
    [null, null, 'Ленина', 1, 5, 4, null],
  ]);
}

export function buildSupplierFixture(bookType: 'xls' | 'xlsx' = 'xlsx'): ArrayBuffer {
  return buildWorkbook(
    [
      ['Контрагент', 'Код', 'Номенклатура', 'Количество', 'Стоимость', 'Ед. изм.'],
      ['Поставщик А', null, null, null, null, null],
      [null, 'SKU1', 'Товар 1', 2, 220, 'шт'],
      [null, 'SKU1', 'Товар 1', 3, 330, 'шт'],
      ['Итого', null, null, 5, 550, null],
      ['Поставщик Б', 'SKU2', 'Товар 2', 4, 800, 'шт'],
    ],
    bookType,
  );
}
