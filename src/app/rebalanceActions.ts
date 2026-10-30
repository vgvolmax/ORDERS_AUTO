import type { AppState } from './appStore';
import { derive } from './selectors';
import { hasIncompatibleTransferQuantities } from './quantityPolicies';
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
  if (command.kind === 'accept') {
    const proposal = state.rebalance.proposal!;
    const selected = new Set(command.ids);
    const accepted = new Set(
      state.rebalance.accepted
        .filter((a) => a.sourceRunId === proposal.runId)
        .map((a) => a.sourceLineId),
    );
    const additions = proposal.transfers.filter(
      (t) => selected.has(t.sourceLineId) && !accepted.has(t.sourceLineId),
    );
    if (hasIncompatibleTransferQuantities(additions, previous.snapshot!.issues))
      throw new RebalanceError('STALE_PROPOSAL');
  }
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
