import type { AppState } from './appStore';
import { normalizeKey } from '../domain/normalize';
import type { BranchRegistry } from '../domain/rebalancing/types';
export function createInitialState(patch: Partial<AppState> = {}): AppState {
  const state: AppState = {
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
  if (state.rebalance.tab === 'priorities')
    state.rebalance = { ...state.rebalance, tab: 'routes' };
  return state;
}
export function reconcileRegistry(
  registry: BranchRegistry,
  names: string[],
  id: () => string,
): BranchRegistry {
  const imported = new Set(names.map(normalizeKey));
  const next = registry.map((b) => ({
    ...b,
    active:
      b.active &&
      [b.name, ...b.aliases].some((name) => imported.has(normalizeKey(name))),
    aliases: [...b.aliases],
  }));
  for (const name of names) {
    const matches = next.filter((b) =>
      [b.name, ...b.aliases].some(
        (v) => normalizeKey(v) === normalizeKey(name),
      ),
    );
    if (!matches.length)
      next.push({ id: id(), name, active: true, aliases: [] });
    // Preserve existing activity choices and ambiguous aliases; validation handles ambiguity.
  }
  return next;
}
