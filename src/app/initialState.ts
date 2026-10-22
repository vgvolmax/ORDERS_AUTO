import type { AppState } from './appStore';
import { normalizeKey } from '../domain/normalize';
import type { BranchRegistry } from '../domain/rebalancing/types';
export function createInitialState(patch: Partial<AppState> = {}): AppState {
  return {
    workspaceId: crypto.randomUUID(),
    workspaceRevision: -1,
    snapshotId: crypto.randomUUID(),
    workspaceCreatedAt: new Date().toISOString(),
    minMax: null,
    suppliers: null,
    minMaxFileName: null,
    supplierFileName: null,
    minMaxIssues: [],
    supplierIssues: [],
    overrides: [],
    edits: [],
    settings: { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' },
    reviewedOrderIds: [],
    exportedOrderIds: [],
    page: 'import',
    importEpoch: 0,
    toast: null,
    minMaxLoading: false,
    supplierLoading: false,
    uiPreferences: {},
    rawImports: { minMax: null, suppliers: null },
    rebalance: {
      registry: [],
      policies: [],
      accepted: [],
      acceptedRevision: 0,
      proposal: null,
      selectedLineIds: [],
      rejectedLineIds: [],
      tab: 'conditions',
      query: '',
      resultScope: {},
      config: {
        recipientTrigger: 'BELOW_MIN',
        receiverPct: 100,
        routeConfig: { mode: 'ALL_ALLOWED', pairs: [] },
        unitPriceFilter: { enabled: false, threshold: 1000 },
        skuAmountFilter: { enabled: false, threshold: 10000 },
      },
    },
    ...patch,
  };
}
export function reconcileRegistry(
  registry: BranchRegistry,
  names: string[],
  id: () => string,
): BranchRegistry {
  const next = registry.map((b) => ({
    ...b,
    active: false,
    aliases: [...b.aliases],
  }));
  for (const name of names) {
    const matches = next.filter((b) =>
      [b.name, ...b.aliases].some(
        (v) => normalizeKey(v) === normalizeKey(name),
      ),
    );
    if (matches.length === 1) matches[0]!.active = true;
    else if (!matches.length)
      next.push({ id: id(), name, active: true, aliases: [] });
    else
      matches.forEach((b) => {
        b.active = true;
      }); // Preserve ambiguity for the snapshot validator, never choose silently.
  }
  return next;
}
