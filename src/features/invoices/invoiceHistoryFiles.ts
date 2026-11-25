import type { InvoiceHistoryDocument } from '../../domain/invoiceHistory';
import {
  InvoiceSheetsRequiredError, parseInvoiceWorkbook, selectInvoiceSheets, type ParsedInvoiceSheet,
} from '../../import/invoiceParser';

export type ArchivedInvoiceFile = {
  id: string;
  name: string;
  status: 'ready';
  bytes: Uint8Array<ArrayBuffer>;
  data: ReturnType<typeof parseInvoiceWorkbook>;
  sheetChoice?: { sheets: ParsedInvoiceSheet[]; selectedNames: string[] };
};

export function archiveInvoiceFile(file: ArchivedInvoiceFile): InvoiceHistoryDocument {
  let binary = '';
  for (let start = 0; start < file.bytes.length; start += 16384) {
    binary += String.fromCharCode(...file.bytes.subarray(start, start + 16384));
  }
  return { name: file.name, sheets: file.sheetChoice?.selectedNames ?? [], base64: btoa(binary) };
}

export function openArchivedInvoiceFile(file: InvoiceHistoryDocument, id: string): ArchivedInvoiceFile {
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  const info = { id, name: file.name, status: 'ready' as const, bytes };
  try {
    return { ...info, data: parseInvoiceWorkbook(bytes.buffer) };
  } catch (failure) {
    if (!(failure instanceof InvoiceSheetsRequiredError)) throw failure;
    return {
      ...info, data: selectInvoiceSheets(failure.sheets, file.sheets),
      sheetChoice: { sheets: failure.sheets, selectedNames: file.sheets },
    };
  }
}
