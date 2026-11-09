import ExcelJS from 'exceljs';
import companyLogo from '../styles/brand/volmax-company.png?inline';
import type { Order, OrderLine } from '../domain/types';
import { uniqueSheetName } from './filenames';
import { moneySum } from '../domain/money';

interface AggregatedLine {
  sample: OrderLine;
  qty: number;
  amounts: number[];
}

export type SupplierWorkbookMode = 'ALL' | 'REVIEWED';

const COMPANY_NAME = 'УК Волмакс';
const COMPANY_SITE = 'volmax.ru';

const C = {
  ink: '172832',
  navy: '173D58',
  muted: '6A8292',
  cyan: '009ADD',
  white: 'FFFFFF',
  pale: 'EEF6FA',
  stripe: 'F6F9FB',
  border: 'DCE8EF',
  secondary: 'EDF2F5',
} as const;

const HEADERS = [
  'Код',
  'Артикул',
  'Номенклатура',
  'Количество',
  'Ед.',
  'Цена, ₽',
  'Сумма, ₽',
] as const;

const MONEY_FORMAT = '#,##0.00" ₽"';
const NUMBER_FORMAT = '#,##0.###';
const FONT = 'Arial';
const HEADER_ROW = 8;
const FIRST_DATA_ROW = HEADER_ROW + 1;

type Sheet = ExcelJS.Worksheet;

export async function buildSupplierWorkbook(
  supplier: string,
  orders: Order[],
  mode: SupplierWorkbookMode = 'ALL',
): Promise<ArrayBuffer> {
  const supplierOrders = orders.filter((order) => order.supplier === supplier);
  const positiveLines = supplierOrders.flatMap((order) =>
    order.lines.filter((line) => line.orderQty > 0),
  );
  const usedSheetNames = new Set<string>();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY_NAME;
  workbook.title = `Заказ поставщику — ${COMPANY_NAME}`;
  workbook.subject = 'Состав заказа поставщику и распределение по подразделениям';
  workbook.company = COMPANY_NAME;

  const logoImage = workbook.addImage({
    base64: companyLogo,
    extension: 'png',
  });
  const generatedAt = new Date();

  const dashboard = workbook.addWorksheet(
    uniqueSheetName('Общий заказ', usedSheetNames),
  );
  const skuCount = new Set(positiveLines.map((line) => line.skuCode)).size;
  const branchCount = new Set(supplierOrders.map((order) => order.branch)).size;
  const totalQty = positiveLines.reduce((sum, line) => sum + line.orderQty, 0);
  const totalAmount = moneySum(positiveLines.map((line) => line.amount ?? 0));

  const aggregated = new Map<string, AggregatedLine>();
  for (const line of positiveLines) {
    const current = aggregated.get(line.skuCode);
    if (current) {
      current.qty += line.orderQty;
      current.amounts.push(line.amount ?? 0);
    } else {
      aggregated.set(line.skuCode, {
        sample: line,
        qty: line.orderQty,
        amounts: [line.amount ?? 0],
      });
    }
  }

  applySheetFrame(dashboard, logoImage, 'ЗАКАЗ ПОСТАВЩИКУ', mode, generatedAt, true);
  applySupplierRow(dashboard, supplier);
  applyMetricBlocks(dashboard, [
    { label: 'СУММА ЗАКАЗА', value: totalAmount, format: MONEY_FORMAT },
    { label: 'АРТИКУЛОВ', value: skuCount },
    { label: 'ПОДРАЗДЕЛЕНИЙ', value: branchCount },
  ]);
  sectionTitle(dashboard, 'СОСТАВ ОБЩЕГО ЗАКАЗА', 'Единиц по строкам: ' + formatQty(totalQty));
  appendTableHeader(dashboard);

  for (const { sample, qty, amounts } of aggregated.values()) {
    addProductRow(dashboard, [
      sample.skuCode,
      sample.article,
      sample.name,
      qty,
      sample.unit,
      sample.unitPrice,
      moneySum(amounts),
    ]);
  }
  finishTable(dashboard, totalQty, totalAmount, FIRST_DATA_ROW + aggregated.size - 1);

  for (const order of supplierOrders) {
    const lines = order.lines.filter((line) => line.orderQty > 0);
    if (lines.length === 0) continue;

    const sheet = workbook.addWorksheet(uniqueSheetName(order.branch, usedSheetNames));
    applySheetFrame(sheet, logoImage, 'ЗАКАЗ ПОДРАЗДЕЛЕНИЯ', mode, generatedAt, false);
    applySupplierRow(sheet, supplier, order.branch);
    applyMetricBlocks(sheet, [
      { label: 'СУММА ЗАКАЗА', value: moneySum(lines.map((line) => line.amount ?? 0)), format: MONEY_FORMAT },
      { label: 'АРТИКУЛОВ', value: new Set(lines.map((line) => line.skuCode)).size },
      { label: 'ЕДИНИЦ ПО СТРОКАМ', value: lines.reduce((sum, line) => sum + line.orderQty, 0), format: NUMBER_FORMAT },
    ]);
    sectionTitle(sheet, 'ПОЗИЦИИ ПОДРАЗДЕЛЕНИЯ', order.branch);
    appendTableHeader(sheet);
    for (const line of lines) {
      addProductRow(sheet, [
        line.skuCode,
        line.article,
        line.name,
        line.orderQty,
        line.unit,
        line.unitPrice,
        line.amount,
      ]);
    }
    finishTable(
      sheet,
      lines.reduce((sum, line) => sum + line.orderQty, 0),
      moneySum(lines.map((line) => line.amount ?? 0)),
      FIRST_DATA_ROW + lines.length - 1,
    );
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

function applySheetFrame(
  sheet: Sheet,
  imageId: number,
  heading: string,
  mode: SupplierWorkbookMode,
  generatedAt: Date,
  mainSheet: boolean,
): void {
  sheet.properties.tabColor = { argb: mainSheet ? C.cyan : '88B8D1' };
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, topLeftCell: 'A9', showGridLines: false }];
  sheet.columns = [
    { width: 17 }, { width: 19 }, { width: 57 },
    { width: 20 }, { width: 13 }, { width: 17 }, { width: 20 },
  ];
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.26, right: 0.26, top: 0.38, bottom: 0.38, header: 0.12, footer: 0.16 },
    printTitlesRow: '8:8',
  };
  sheet.headerFooter.oddFooter = `&L${COMPANY_NAME} · ${COMPANY_SITE}&CЗаказ поставщику&RСтраница &P из &N`;
  sheet.addImage(imageId, {
    tl: { col: 0.07, row: 0.04 },
    ext: { width: 300, height: 300 * 399 / 2048 },
    editAs: 'oneCell',
  });

  sheet.getRow(1).height = 47;
  sheet.getRow(2).height = 23;
  sheet.getRow(3).height = 31;
  sheet.getRow(4).height = 8;
  sheet.getRow(5).height = 24;
  sheet.getRow(6).height = 42;
  sheet.getRow(7).height = 32;
  sheet.getRow(8).height = 35;
  sheet.mergeCells('A2:D2');
  sheet.mergeCells('E1:G1');
  sheet.mergeCells('E2:G2');
  const company = sheet.getCell('A2');
  company.value = COMPANY_NAME;
  company.font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } };
  company.alignment = { vertical: 'middle', indent: 1 };

  const head = sheet.getCell('E1');
  head.value = heading;
  head.font = { name: FONT, size: 13, bold: true, color: { argb: C.navy } };
  head.alignment = { horizontal: 'right', vertical: 'middle' };
  const subhead = sheet.getCell('E2');
  subhead.value = (mode === 'REVIEWED' ? 'ПРОВЕРЕННЫЕ ЗАКАЗЫ' : 'ВСЕ ЗАКАЗЫ') +
    '  ·  ' + generatedAt.toLocaleDateString('ru-RU');
  subhead.font = { name: FONT, size: 9, color: { argb: C.muted } };
  subhead.alignment = { horizontal: 'right', vertical: 'middle' };
}

function applySupplierRow(sheet: Sheet, supplier: string, branch?: string): void {
  sheet.getRow(3).eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = fill(C.pale);
  });
  sheet.getCell('A3').value = 'ПОСТАВЩИК';
  sheet.getCell('A3').font = { name: FONT, size: 9, bold: true, color: { argb: C.muted } };
  sheet.getCell('A3').alignment = { vertical: 'middle', indent: 1 };
  sheet.mergeCells('B3:G3');
  sheet.getCell('B3').value = branch ? supplier + '  ·  ' + branch : supplier;
  sheet.getCell('B3').font = { name: FONT, size: 12, bold: true, color: { argb: C.ink } };
  sheet.getCell('B3').alignment = { vertical: 'middle', shrinkToFit: true };
}

function applyMetricBlocks(
  sheet: Sheet,
  metrics: Array<{ label: string; value: number; format?: string }>,
): void {
  const blocks = [
    ['A5:B5', 'A6:B6', 'A5', 'A6'],
    ['C5:D5', 'C6:D6', 'C5', 'C6'],
    ['E5:G5', 'E6:G6', 'E5', 'E6'],
  ] as const;
  metrics.forEach((metric, i) => {
    const [labelRange, valueRange, labelAddress, valueAddress] = blocks[i]!;
    sheet.mergeCells(labelRange);
    sheet.mergeCells(valueRange);
    for (const range of [labelRange, valueRange]) {
      sheet.getCell(range.split(':')[0]!).fill = fill(C.pale);
    }
    const label = sheet.getCell(labelAddress);
    label.value = metric.label;
    label.font = { name: FONT, size: 9, bold: true, color: { argb: C.muted } };
    label.alignment = { vertical: 'bottom', indent: 1 };
    const value = sheet.getCell(valueAddress);
    value.value = metric.value;
    value.numFmt = metric.format ?? NUMBER_FORMAT;
    value.font = { name: FONT, size: 19, bold: true, color: { argb: C.navy } };
    value.alignment = { vertical: 'middle', indent: 1 };
  });
}

function sectionTitle(sheet: Sheet, title: string, detail: string): void {
  sheet.mergeCells('A7:D7');
  sheet.mergeCells('E7:G7');
  sheet.getCell('A7').value = title;
  sheet.getCell('A7').font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } };
  sheet.getCell('A7').alignment = { vertical: 'middle' };
  sheet.getCell('E7').value = detail;
  sheet.getCell('E7').font = { name: FONT, size: 9, color: { argb: C.muted } };
  sheet.getCell('E7').alignment = { vertical: 'middle', horizontal: 'right', shrinkToFit: true };
}

function appendTableHeader(sheet: Sheet): void {
  const row = sheet.getRow(HEADER_ROW);
  row.values = [...HEADERS];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = fill(C.navy);
    cell.alignment = {
      vertical: 'middle',
      horizontal: col >= 4 && col !== 5 ? 'right' : 'left',
      indent: col === 1 ? 1 : 0,
    };
    cell.border = { bottom: { style: 'medium', color: { argb: C.cyan } } };
  });
}

function addProductRow(sheet: Sheet, values: Array<string | number | null>): void {
  const row = sheet.addRow(values);
  const index = row.number - FIRST_DATA_ROW;
  row.height = Math.min(65, Math.max(24, Math.ceil(String(values[2] ?? '').length / 49) * 15 + 7));
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill = fill(index % 2 === 0 ? C.white : C.stripe);
    cell.font = {
      name: FONT, size: 10,
      bold: col === 1 || col === 4 || col === 7,
      color: { argb: col === 7 ? C.navy : C.ink },
    };
    cell.alignment = {
      vertical: 'middle', wrapText: col === 3,
      horizontal: col === 4 || col === 6 || col === 7 ? 'right' : 'left',
      indent: col === 1 ? 1 : 0,
    };
    cell.border = { bottom: { style: 'hair', color: { argb: C.border } } };
  });
  row.getCell(1).numFmt = '@';
  row.getCell(2).numFmt = '@';
  row.getCell(4).numFmt = NUMBER_FORMAT;
  row.getCell(6).numFmt = MONEY_FORMAT;
  row.getCell(7).numFmt = MONEY_FORMAT;
}

function finishTable(
  sheet: Sheet,
  totalQty: number,
  totalAmount: number,
  lastDataRow: number,
): void {
  const summaryIndex = Math.max(FIRST_DATA_ROW, lastDataRow + 1);
  const total = sheet.getRow(summaryIndex);
  total.values = ['ИТОГО', null, null, totalQty, null, null, totalAmount];
  sheet.mergeCells('A' + summaryIndex + ':C' + summaryIndex);
  total.height = 33;
  total.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill = fill(C.pale);
    cell.font = { name: FONT, size: col === 7 ? 13 : 11, bold: true, color: { argb: C.navy } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col === 4 || col === 7 ? 'right' : 'left',
      indent: col === 1 ? 1 : 0,
    };
    cell.border = { top: { style: 'medium', color: { argb: C.cyan } } };
  });
  total.getCell(4).numFmt = NUMBER_FORMAT;
  total.getCell(7).numFmt = MONEY_FORMAT;
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: Math.max(HEADER_ROW, lastDataRow), column: HEADERS.length },
  };
  const footer = sheet.getRow(summaryIndex + 2);
  footer.height = 23;
  sheet.mergeCells('A' + footer.number + ':G' + footer.number);
  footer.getCell(1).value = `${COMPANY_NAME}  ·  ${COMPANY_SITE}  ·  Документ сформирован для поставщика`;
  footer.getCell(1).font = { name: FONT, size: 9, color: { argb: C.muted } };
  footer.getCell(1).alignment = { vertical: 'middle' };
  sheet.pageSetup.printArea = 'A1:G' + footer.number;
}

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function formatQty(qty: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(qty);
}
