import * as XLSX from 'xlsx';
import { normalizeKey } from '../domain/normalize';

export function readFirstSheetRows(input: ArrayBuffer): unknown[][] {
  const workbook = XLSX.read(input, {
    type: 'array',
    cellDates: false,
    cellNF: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const codeNames = new Set(['код', 'код номенклатуры']);
  const header = rows.findIndex((row) =>
    row.some((value) => codeNames.has(normalizeKey(value))),
  );
  if (header < 0) return rows;
  const codeColumns = rows[header]!.flatMap((value, column) =>
    codeNames.has(normalizeKey(value)) ? [column] : [],
  );
  const origin = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').s;
  for (let row = header + 1; row < rows.length; row++)
    for (const column of codeColumns) {
      const cell =
        sheet[
          XLSX.utils.encode_cell({ r: row + origin.r, c: column + origin.c })
        ];
      if (cell?.t === 'n') {
        // General/scientific display formats round long identifiers. Only a
        // pure zero mask can add leading zeros without losing numeric digits.
        const mask = typeof cell.z === 'string' ? cell.z : '';
        rows[row]![column] =
          /^0+$/.test(mask) && Number.isSafeInteger(cell.v) && cell.v >= 0
            ? String(cell.v).padStart(mask.length, '0')
            : String(cell.v);
      }
    }
  return rows;
}
