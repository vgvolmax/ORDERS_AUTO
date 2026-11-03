import type { AcceptedTransferFilters } from '../../domain/workspace';
import {
  buildTransferDocuments,
  type TransferDocument,
  type TransferDocumentsInput,
} from './transferDocuments';

export const emptyAcceptedFilters: AcceptedTransferFilters = {
  query: '',
  fromBranchId: '',
  toBranchId: '',
};

/** Accepted ledger is the only source. A result query must never trim export composition. */
export function buildAcceptedDocuments(
  input: Pick<
    TransferDocumentsInput,
    'accepted' | 'registry' | 'policies' | 'skus' | 'snapshot'
  >,
) {
  return buildTransferDocuments({
    ...input,
    proposal: null,
    selected: [],
    rejected: [],
    query: '',
    scope: {},
  });
}

export function filterAcceptedDocuments(
  documents: TransferDocument[],
  filters: AcceptedTransferFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase('ru');
  return documents.filter(
    (doc) =>
      (!filters.fromBranchId || doc.fromBranchId === filters.fromBranchId) &&
      (!filters.toBranchId || doc.toBranchId === filters.toBranchId) &&
      (!query ||
        [
          doc.fromName + ' → ' + doc.toName,
          ...doc.lines.flatMap((l) => [l.skuCode, l.article ?? '', l.name]),
        ]
          .join(' ')
          .toLocaleLowerCase('ru')
          .includes(query)),
  );
}
