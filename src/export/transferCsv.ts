import type { TransferDocument } from '../features/rebalancing/transferDocuments';
import { rowsToCsv } from './csv';
import { formatLocalDate } from './date';
import { safeFilename } from './filenames';

export function transferToCsv(doc: TransferDocument): string {
  return rowsToCsv(
    [
      'Код',
      'Артикул',
      'Номенклатура',
      'Отправитель',
      'Получатель',
      'Количество',
      'Ед.',
      'Цена MIN/MAX',
      'Сумма',
    ],
    doc.lines
      .filter((line) => line.decision === 'ACCEPTED' && line.qty > 0)
      .map((line) => [
        line.skuCode,
        line.article,
        line.name,
        doc.fromName,
        doc.toName,
        line.qty,
        line.unit,
        line.unitPrice,
        line.amount,
      ]),
  );
}

export function transferCsvFilename(
  doc: TransferDocument,
  date = new Date(),
): string {
  return `Перемещение__${safeFilename(doc.fromName)}__${safeFilename(doc.toName)}__${formatLocalDate(date)}.csv`;
}
