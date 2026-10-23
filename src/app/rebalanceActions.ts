import {
  setDonorPriorities,
  setDonorQuantity,
  setDonorSplitMode,
} from '../domain/rebalancing/allocationPlan';
import type { DonorSplitMode } from '../domain/rebalancing/types';
import type { AppState } from './appStore';
import { derive } from './selectors';
import {
  acceptTransfers,
  revokeTransfers,
  calculateRebalance,
  rebalanceConfigFingerprint,
  RebalanceError,
  type RebalanceProposal,
} from '../domain/rebalancing';
import { buildAcceptedTransferStatePatch } from '../domain/rebalanceWorkflow';

export function createProposal(state: AppState): RebalanceProposal {
  const snapshot = derive(state).snapshot?.snapshot;
  if (!snapshot) throw new Error('Сначала загрузите оба отчёта');
  const config = structuredClone(state.rebalance.config);
  return {
    ...calculateRebalance(snapshot, config, state.rebalance.accepted),
    runId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    snapshotId: state.snapshotId,
    baseAcceptedRevision: state.rebalance.acceptedRevision,
    configFingerprint: rebalanceConfigFingerprint(config),
    config,
  };
}

export function prepareAcceptedChange(
  state: AppState,
  command: {
    kind: 'accept' | 'revoke';
    ids: string[];
    expectedRevision: number;
  },
) {
  const previous = derive(state),
    snapshot = previous.snapshot?.snapshot;
  if (!snapshot) throw new Error('Сначала загрузите оба отчёта');
  const common = {
    snapshot,
    currentAccepted: state.rebalance.accepted,
    currentRevision: state.rebalance.acceptedRevision,
    expectedRevision: command.expectedRevision,
  };
  if (command.kind === 'accept' && !state.rebalance.proposal)
    throw new RebalanceError('STALE_PROPOSAL');
  const change =
    command.kind === 'accept'
      ? acceptTransfers({
          ...common,
          currentProposal: state.rebalance.proposal!,
          selectedLineIds: command.ids,
          currentConfigFingerprint: rebalanceConfigFingerprint(
            state.rebalance.config,
          ),
          acceptedAt: new Date().toISOString(),
          transferIdBySourceLineId: Object.fromEntries(
            command.ids.map((id) => [id, crypto.randomUUID()]),
          ),
        })
      : revokeTransfers({ ...common, transferIds: command.ids });
  if (change.nextRevision === state.rebalance.acceptedRevision)
    return {
      patch: {},
      clearedEditCount: 0,
      affectedOrderIds: [],
      diagnostics: change.diagnostics,
    };
  const rebalance = {
    ...state.rebalance,
    accepted: change.nextAccepted,
    acceptedRevision: change.nextRevision,
    selectedLineIds:
      command.kind === 'accept'
        ? state.rebalance.selectedLineIds.filter(
            (id) => !command.ids.includes(id),
          )
        : state.rebalance.selectedLineIds,
  };
  const next = derive({ ...state, rebalance });
  const workflow = buildAcceptedTransferStatePatch({
    previousDemand: previous.purchaseDemand,
    nextDemand: next.purchaseDemand,
    previousProjection: previous.projection,
    resolutions: next.resolutions,
    settings: state.settings,
    edits: state.edits,
    reviewedOrderIds: state.reviewedOrderIds,
    exportedOrderIds: state.exportedOrderIds,
  });
  return {
    patch: {
      rebalance,
      edits: workflow.edits,
      reviewedOrderIds: workflow.reviewedOrderIds,
      exportedOrderIds: workflow.exportedOrderIds,
    },
    clearedEditCount: workflow.clearedEditCount,
    affectedOrderIds: workflow.affectedOrderIds,
    diagnostics: change.diagnostics,
  };
}

export type DonorPlanCommand =
  | {
      kind: 'priorities';
      skuCode: string;
      fromBranchId: string;
      recipientIds: string[];
    }
  | {
      kind: 'quantity';
      skuCode: string;
      fromBranchId: string;
      toBranchId: string;
      qty: number;
    }
  | { kind: 'mode'; fromBranchId: string; mode: DonorSplitMode };
/** Called inside the existing durable workspace queue, always using its latest state. */
export function prepareDonorPlanChange(
  state: AppState,
  command: DonorPlanCommand,
  expected: { runId: string; acceptedRevision: number },
) {
  const proposal = state.rebalance.proposal;
  const snapshot = derive(state).snapshot?.snapshot;
  if (
    !proposal ||
    !snapshot ||
    proposal.runId !== expected.runId ||
    proposal.snapshotId !== state.snapshotId ||
    proposal.configFingerprint !==
      rebalanceConfigFingerprint(state.rebalance.config)
  )
    throw new RebalanceError('STALE_PROPOSAL');
  if (state.rebalance.acceptedRevision !== expected.acceptedRevision)
    throw new RebalanceError('REVISION_CONFLICT');
  const ctx = { snapshot, proposal, accepted: state.rebalance.accepted };
  const next =
    command.kind === 'mode'
      ? setDonorSplitMode(ctx, command.fromBranchId, command.mode)
      : command.kind === 'priorities'
        ? setDonorPriorities(
            ctx,
            command.skuCode,
            command.fromBranchId,
            command.recipientIds,
          )
        : setDonorQuantity(
            ctx,
            command.skuCode,
            command.fromBranchId,
            command.toBranchId,
            command.qty,
          );
  const previousQty = new Map(
    proposal.transfers.map((t) => [t.sourceLineId, t.qty]),
  );
  const unchanged = new Set(
    next.transfers
      .filter((t) => previousQty.get(t.sourceLineId) === t.qty)
      .map((t) => t.sourceLineId),
  );
  return {
    rebalance: {
      ...state.rebalance,
      proposal: next,
      selectedLineIds: state.rebalance.selectedLineIds.filter((id) =>
        unchanged.has(id),
      ),
      rejectedLineIds: state.rebalance.rejectedLineIds.filter((id) =>
        unchanged.has(id),
      ),
    },
  };
}
