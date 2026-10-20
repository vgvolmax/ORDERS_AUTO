import type { MinMaxDataset, ValidationIssue } from '../types';

export interface RebalanceBranch { id: string; name: string; active: boolean; aliases: string[] }
export type BranchRegistry = RebalanceBranch[];
export interface RebalanceSku { skuCode: string; name: string; unit: string | null; quantityStep: number | null; referencePrice: number | null }
export interface RebalanceStock { skuCode: string; branchId: string; stock: number; min: number | null; max: number | null; sourceRow: number | null }
export interface RebalanceSnapshot { schemaVersion: 1; snapshotId: string; branches: RebalanceBranch[]; skus: RebalanceSku[]; stocks: RebalanceStock[] }
export interface RebalanceIssue {
  code: string; message: string; severity: 'WARNING' | 'ERROR'; sourceRow: number | null;
  skuCode?: string; branchId?: string; stockIndex?: number;
}
export interface SkuQuantityPolicy { skuCode: string; unit: string; quantityStep: number }
export interface SnapshotAdapterInput {
  snapshotId: string; dataset: MinMaxDataset; branchRegistry: BranchRegistry; skuPolicies: SkuQuantityPolicy[];
  sourceRows?: Array<{ skuCode: string; branch: string; row: number }>;
  sourceIssues?: ValidationIssue[];
}
export interface SnapshotBuildResult { snapshot: RebalanceSnapshot; issues: RebalanceIssue[] }
export type RouteDirection = 'BOTH' | 'A_TO_B' | 'B_TO_A' | 'BLOCKED';
export interface RoutePair { branchAId: string; branchBId: string; direction: RouteDirection }
export interface RouteConfig { mode: 'ALL_ALLOWED' | 'SELECTIVE'; pairs: RoutePair[] }
export interface MoneyFilter { enabled: boolean; threshold: number }
export interface RebalanceConfig {
  recipientTrigger: 'BELOW_MIN' | 'BELOW_MAX'; receiverPct: number; routeConfig: RouteConfig;
  unitPriceFilter: MoneyFilter; skuAmountFilter: MoneyFilter;
}
export interface RebalanceTransfer { sourceLineId: string; skuCode: string; fromBranchId: string; toBranchId: string; qty: number }
export interface AcceptedTransfer {
  transferId: string; sourceRunId: string; sourceLineId: string; skuCode: string; fromBranchId: string; toBranchId: string;
  qty: number; snapshotId: string; acceptedAt: string; acceptedConfig: RebalanceConfig;
}
export interface RebalanceBalance { skuCode: string; branchId: string; stockBefore: number; acceptedIncoming: number; acceptedOutgoing: number; proposedIncoming: number; proposedOutgoing: number; stockAfter: number }
export interface UncoveredNeed { skuCode: string; branchId: string; toMin: number; toTarget: number }
export interface RebalanceResult {
  inputFingerprint: string; algorithmVersion: string; transfers: RebalanceTransfer[]; eligibleRecipientKeys: string[];
  uncoveredNeed: UncoveredNeed[]; balances: RebalanceBalance[]; exclusions: RebalanceIssue[];
}
export interface RebalanceProposal extends RebalanceResult {
  runId: string; createdAt: string; snapshotId: string; baseAcceptedRevision: number; configFingerprint: string;
  /** Exact physical/calculation inputs used for this proposal, never a live settings reference. */
  config: RebalanceConfig;
}
export interface AcceptTransfersInput {
  snapshot: RebalanceSnapshot; currentAccepted: AcceptedTransfer[]; currentProposal: RebalanceProposal; selectedLineIds: string[];
  currentRevision: number; expectedRevision: number; currentConfigFingerprint: string; acceptedAt: string;
  transferIdBySourceLineId: Readonly<Record<string, string>>;
}
export interface RevokeTransfersInput { snapshot: RebalanceSnapshot; currentAccepted: AcceptedTransfer[]; transferIds: string[]; currentRevision: number; expectedRevision: number }
export interface AcceptedTransferChange { nextAccepted: AcceptedTransfer[]; changedSkuBranchKeys: string[]; nextRevision: number }
export type RebalanceErrorCode = 'INVALID_SNAPSHOT' | 'INVALID_CONFIG' | 'INVALID_ACCEPTED_LEDGER' | 'REVISION_CONFLICT' | 'STALE_PROPOSAL' | 'TRANSFER_ID_CONFLICT' | 'INVALID_TRANSFER_BATCH';
export class RebalanceError extends Error {
  constructor(public readonly code: RebalanceErrorCode, public readonly issues: RebalanceIssue[] = []) {
    super(code); this.name = 'RebalanceError';
  }
}
export const stockKey = (skuCode: string, branchId: string): string => JSON.stringify([skuCode, branchId]);
