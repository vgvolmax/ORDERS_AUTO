import JSZip from 'jszip';
import type { Order } from '../domain/types';
import { orderToCsv } from './csv';
import { orderCsvFilename, ordersZipFilename } from './orderFilenames';
import type { TransferDocument } from '../features/rebalancing/transferDocuments';
import { transferToCsv, transferCsvFilename } from './transferCsv';

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

export async function downloadReadyOrdersZip(orders: Order[]): Promise<void> {
  const zip = new JSZip();
  const date = new Date();

  for (const order of orders.filter(
    (item) => item.status === 'READY' || item.status === 'EXPORTED',
  )) {
    zip.file(orderCsvFilename(order, date), orderToCsv(order));
  }

  save(await zip.generateAsync({ type: 'blob' }), ordersZipFilename(date));
}
