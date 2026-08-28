import * as XLSX from 'xlsx';

export function readFirstSheetRows(input: ArrayBuffer): unknown[][] {
  const workbook = XLSX.read(input, { type: 'array', cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]!, {
    header: 1,
    raw: true,
    defval: null,
  });
}
