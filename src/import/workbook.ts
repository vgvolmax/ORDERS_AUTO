import * as XLSX from 'xlsx';
import { normalizeText } from '../domain/normalize';

const INVALID_EXCEL_NUMBER = Symbol('Некорректное число Excel');

export function readFirstSheet(input: ArrayBuffer) {
  const workbook = XLSX.read(input, {
    type: 'array',
    cellDates: false,
    cellNF: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
  const rows = sheet
    ? XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
      })
    : [];
  const origin = XLSX.utils.decode_range(sheet?.['!ref'] ?? 'A1').s;
  const cellAt = (row: number, column: number) =>
    sheet?.[XLSX.utils.encode_cell({ r: row + origin.r, c: column + origin.c })];

  return {
    rows,
    readCode(row: number, column: number): string {
      const value = rows[row]?.[column];
      if (typeof value !== 'number') return normalizeText(value);
      // General and scientific display formats can round long identifiers.
      // A pure zero mask adds leading zeros without losing numeric digits.
      const mask = cellAt(row, column)?.z ?? '';
      return /^0+$/.test(mask) && Number.isSafeInteger(value) && value >= 0
        ? String(value).padStart(mask.length, '0')
        : String(value);
    },
    keepNumericErrors(firstRow: number, columns: readonly number[]): void {
      // The raw row conversion treats Excel error cells as empty. Preserve
      // the distinction in numeric columns selected by the report parser.
      for (let index = firstRow; index < rows.length; index += 1) {
        const row = rows[index]!;
        for (const column of columns)
          if (row[column] == null && cellAt(index, column)?.t === 'e')
            row[column] = INVALID_EXCEL_NUMBER;
      }
    },
  };
}
