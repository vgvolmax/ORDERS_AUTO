import JSZip from 'jszip';
import type { Order } from '../domain/types';
import { orderToCsv } from './csv';
import { orderCsvFilename, ordersZipFilename } from './orderFilenames';
import type { TransferDocument } from '../features/rebalancing/transferDocuments';
import {
  transferToCsv,
  transferCsvFilename,
  transfersToCsv,
} from './transferCsv';
import { formatLocalDate } from './date';

export function save(blob: Blob, name: string): void {
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(order: Order): void {
  save(
    new Blob([orderToCsv(order)], { type: 'text/csv;charset=utf-8' }),
    orderCsvFilename(order),
  );
}

export function downloadTransferCsv(doc: TransferDocument): void {
  if (!doc.lines.some((line) => line.decision === 'ACCEPTED' && line.qty > 0))
    throw new Error('В перемещении нет принятых позиций для CSV.');
  save(
    new Blob([transferToCsv(doc)], { type: 'text/csv;charset=utf-8' }),
    transferCsvFilename(doc),
  );
}

export function downloadAcceptedTransfersCsv(
  documents: TransferDocument[],
): void {
  if (
    !documents.length ||
    documents.some(
      (doc) => !doc.lines.some((l) => l.decision === 'ACCEPTED' && l.qty > 0),
    )
  )
    throw new Error('Нет принятых перемещений для CSV.');
  if (documents.length === 1) return downloadTransferCsv(documents[0]!);
  save(
    new Blob([transfersToCsv(documents)], { type: 'text/csv;charset=utf-8' }),
    `Принятые_перемещения__${formatLocalDate(new Date())}.csv`,
  );
}

export async function downloadReadyOrdersZip(
  orders: Order[],
  beforeDownload?: () => Promise<void>,
): Promise<void> {
  const zip = new JSZip();
  const date = new Date();
  const usedNames = new Set<string>();

  for (const order of orders.filter(
    (item) => item.status === 'READY' || item.status === 'EXPORTED',
  )) {
    let filename = orderCsvFilename(order, date);
    const stem = filename.slice(0, -'.csv'.length);
    for (let suffix = 2; usedNames.has(filename.toLowerCase()); suffix++) {
      filename = `${stem} (${suffix}).csv`;
    }
    usedNames.add(filename.toLowerCase());
    zip.file(filename, orderToCsv(order));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  await beforeDownload?.();
  save(blob, ordersZipFilename(date));
}
