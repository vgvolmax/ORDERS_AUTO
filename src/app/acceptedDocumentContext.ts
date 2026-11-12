import type { AppState } from './appStore';
import { derive } from './selectors';
import type { AcceptedTransfer } from '../domain/rebalancing/types';

/** Capture once, before applying a live catalog to legacy accepted rows. */
export function freezeAcceptedDocuments(state: AppState, accepted = state.rebalance.accepted): AcceptedTransfer[] {
  if (accepted.every(line => line.document)) return accepted;
  const derived = derive(state);
  const skus = new Map(state.minMax?.skus.map(sku => [sku.code, sku]));
  const units = new Map(derived.quantityPolicies.map(policy => [policy.skuCode, policy.unit]));
  const suppliers = new Map(derived.resolutions.map(row => [row.skuCode, row.selectedSupplier]));
  const branches = new Map(state.rebalance.registry.map(branch => [branch.id, branch.name]));
  return accepted.map(line => {
    if (line.document) return line;
    const sku = skus.get(line.skuCode);
    const price = sku?.referencePrice;
    return { ...line, document: {
      schemaVersion: 1,
      article: sku?.article ?? null,
      name: sku?.name ?? line.skuCode,
      unit: units.get(line.skuCode) ?? null,
      unitPrice: price != null && Number.isFinite(price) && price >= 0 ? price : null,
      supplier: suppliers.get(line.skuCode) ?? null,
      fromName: branches.get(line.fromBranchId) ?? line.fromBranchId,
      toName: branches.get(line.toBranchId) ?? line.toBranchId,
    } };
  });
}
