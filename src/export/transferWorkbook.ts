import ExcelJS from 'exceljs';
import companyLogo from '../styles/brand/volmax-company.png?inline';
import { moneySum } from '../domain/money';
import type { TransferDocument } from '../features/rebalancing/transferDocuments';
import { formatLocalDate } from './date';
import { directedSheetName, safeFilename } from './filenames';

const COMPANY = 'УК Волмакс';
const SUMMARY = 'Сводка';
const FONT = 'Arial';
const HEADER_ROW = 5;
const QUANTITY = '#,##0.############';
const MONEY = '#,##0.00##########" ₽"';
const C = {
  ink: 'FF172832',
  navy: 'FF173D58',
  muted: 'FF6A8292',
  cyan: 'FF009ADD',
  white: 'FFFFFFFF',
  pale: 'FFEEF6FA',
  stripe: 'FFF6F9FB',
  border: 'FFDCE8EF',
};

const SUMMARY_COLUMNS = [
  { title: 'Отправитель', width: 38 },
  { title: 'Получатель', width: 38 },
  { title: 'Позиций', width: 13, format: '#,##0' },
  { title: 'SKU', width: 12, format: '#,##0' },
  { title: 'Сумма, ₽', width: 23, format: MONEY },
];
const DIRECTION_COLUMNS = [
  { title: 'Код', width: 19, format: '@' },
  { title: 'Артикул', width: 19, format: '@' },
  { title: 'Номенклатура', width: 58 },
  { title: 'Количество', width: 17, format: QUANTITY },
  { title: 'Ед.', width: 12 },
  { title: 'Цена MIN/MAX, ₽', width: 19, format: MONEY },
  { title: 'Сумма, ₽', width: 23, format: MONEY },
];

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function totalAmount(values: (number | null)[]): number | null {
  const known = values.filter((value) => value !== null);
  if (known.length !== values.length) return null;
  const amount = moneySum(known);
  return Number.isFinite(amount) ? amount : null;
}

function setupSheet(
  sheet: ExcelJS.Worksheet,
  logo: number,
  heading: string,
  columns: { title: string; width: number; format?: string }[],
) {
  const lastColumn = columns.length;
  sheet.columns = columns.map(({ width, format }) => ({
    width,
    ...(format && { style: { numFmt: format } }),
  }));
  sheet.properties.tabColor = { argb: sheet.name === SUMMARY ? C.cyan : 'FF88B8D1' };
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
  };
  sheet.addImage(logo, {
    tl: { col: 0.07, row: 0.04 },
    ext: { width: 260, height: 260 * 399 / 2048 },
    editAs: 'oneCell',
  });
  sheet.getRow(1).height = 43;
  sheet.mergeCells(1, 3, 1, lastColumn);
  const label = sheet.getCell('C1');
  label.value = 'ПРИНЯТЫЕ ПЕРЕМЕЩЕНИЯ';
  label.font = { name: FONT, size: 12, bold: true, color: { argb: C.navy } };
  label.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getCell('A2').value = COMPANY;
  sheet.getCell('A2').font = { name: FONT, size: 10, color: { argb: C.muted } };
  sheet.getRow(3).height = 39;
  sheet.mergeCells(3, 1, 3, lastColumn);
  const title = sheet.getCell('A3');
  title.value = heading;
  title.fill = fill(C.pale);
  title.font = { name: FONT, size: 15, bold: true, color: { argb: C.navy } };
  title.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  sheet.getRow(4).height = 8;
  const header = sheet.getRow(HEADER_ROW);
  header.values = columns.map(({ title }) => title);
  header.height = 30;
  header.eachCell((cell) => {
    cell.fill = fill(C.navy);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: C.white } };
    cell.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  });
}

function addRow(
  sheet: ExcelJS.Worksheet,
  values: (string | number | null)[],
  total = false,
) {
  const row = sheet.addRow(values);
  let height = total ? 31 : 24;
  const background = total ? C.pale : row.number % 2 === 0 ? C.white : C.stripe;
  for (let index = 1; index <= values.length; index++) {
    const cell = row.getCell(index);
    const value = cell.value;
    if (typeof value === 'string') {
      const characters = (sheet.getColumn(index).width ?? 15) - 5;
      const lines = value.split('\n').reduce(
        (count, part) => count + Math.max(1, Math.ceil(part.length / characters)),
        0,
      );
      height = Math.max(height, 14 * lines + 8);
    }
    cell.fill = fill(background);
    cell.font = { name: FONT, size: 11, bold: total, color: { argb: C.ink } };
    cell.alignment = {
      horizontal: typeof value === 'number' ? 'right' : 'left',
      vertical: 'middle',
      wrapText: typeof value === 'string',
      indent: 1,
    };
    cell.border = total
      ? { top: { style: 'medium', color: { argb: C.cyan } } }
      : { bottom: { style: 'hair', color: { argb: C.border } } };
  }
  row.height = Math.min(409, height);
  if (total) {
    sheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: row.number - 1, column: values.length },
    };
  }
}

export async function buildAcceptedTransfersWorkbook(
  documents: TransferDocument[],
): Promise<ArrayBuffer> {
  const routes = documents
    .map((doc) => {
      const lines = doc.lines.filter((line) => line.decision === 'ACCEPTED' && line.qty > 0);
      return {
        doc,
        lines,
        skuCount: new Set(lines.map((line) => line.skuCode)).size,
        amount: totalAmount(lines.map((line) => line.amount)),
      };
    })
    .filter(({ lines }) => lines.length > 0);
  if (!routes.length) throw new Error('Нет принятых перемещений для Excel.');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY;
  workbook.company = COMPANY;
  workbook.title = 'Принятые перемещения';
  const logo = workbook.addImage({ base64: companyLogo, extension: 'png' });
  const summary = workbook.addWorksheet(SUMMARY);
  const usedNames = new Set([SUMMARY]);
  setupSheet(summary, logo, 'Сводка по направлениям', SUMMARY_COLUMNS);

  for (const { doc, lines, skuCount, amount } of routes) {
    addRow(summary, [doc.fromName, doc.toName, lines.length, skuCount, amount]);
    const sheet = workbook.addWorksheet(
      directedSheetName(doc.fromName, doc.toName, usedNames),
    );
    setupSheet(sheet, logo, `${doc.fromName} → ${doc.toName}`, DIRECTION_COLUMNS);
    for (const line of lines) {
      addRow(sheet, [
        line.skuCode,
        line.article,
        line.name,
        line.qty,
        line.unit,
        line.unitPrice,
        line.amount,
      ]);
    }
    addRow(sheet, ['ИТОГО', null, null, null, null, null, amount], true);
  }

  addRow(summary, [
    'ИТОГО',
    null,
    routes.reduce((count, { lines }) => count + lines.length, 0),
    new Set(routes.flatMap(({ lines }) => lines.map((line) => line.skuCode))).size,
    totalAmount(routes.map(({ amount }) => amount)),
  ], true);
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export function acceptedTransfersWorkbookFilename(
  documents: TransferDocument[],
  date = new Date(),
): string {
  const doc = documents.length === 1 ? documents[0] : undefined;
  const stem = doc
    ? `Перемещение__${safeFilename(doc.fromName)}__${safeFilename(doc.toName)}`
    : 'Принятые_перемещения';
  return `${stem}__${formatLocalDate(date)}.xlsx`;
}
