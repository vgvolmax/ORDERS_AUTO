import type { AppState } from './appStore';
import { derive } from './selectors';
import { hasIncompatibleTransferQuantities } from './quantityPolicies';
import {
  ALGORITHM_VERSION,
  acceptTransfers,
  branchParticipationFingerprint,
  revokeTransfers,
  calculateRebalance,
  rebalanceConfigFingerprint,
  RebalanceError,
  type RebalanceProposal,
} from '../domain/rebalancing';
import { buildAcceptedTransferStatePatch } from '../domain/rebalanceWorkflow';
import {
  assertEditableTransferQuantity,
  type TransferQuantityInput,
} from '../domain/rebalancing/manualTransferQuantity';

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

function editableTransfer(state: AppState, sourceLineId: string) {
  const derived = derive(state);
  const snapshot = derived.snapshot?.snapshot;
  const { proposal, accepted, rejectedLineIds, config } = state.rebalance;
  const line = proposal?.transfers.find((t) => t.sourceLineId === sourceLineId);
  if (
    !snapshot || !proposal || !line ||
    proposal.snapshotId !== snapshot.snapshotId ||
    proposal.algorithmVersion !== ALGORITHM_VERSION ||
    proposal.participationFingerprint !== branchParticipationFingerprint(snapshot.branches) ||
    hasIncompatibleTransferQuantities([line], derived.snapshot!.issues)
  ) throw new RebalanceError('STALE_PROPOSAL');
  const input: TransferQuantityInput = { snapshot, proposal, accepted, rejectedLineIds, config };
  return { input, line };
}

export function prepareTransferQuantityEdit(
  state: AppState,
  sourceLineId: string,
  qty: number,
): Partial<AppState> {
  const { input, line } = editableTransfer(state, sourceLineId);
  if (input.rejectedLineIds.includes(sourceLineId))
    throw new RebalanceError('STALE_PROPOSAL');
  assertEditableTransferQuantity(input, sourceLineId, qty);
  if (line.qty === qty) return {};
  const { originalQty = line.qty, ...base } = line;
  const updated = qty === originalQty ? { ...base, qty } : { ...base, qty, originalQty };
  return {
    rebalance: {
      ...state.rebalance,
      proposal: {
        ...input.proposal,
        transfers: input.proposal.transfers.map((t) => t === line ? updated : t),
      },
    },
  };
}

export function validateTransferRestoration(
  state: AppState,
  sourceLineId: string,
  rejectedLineIds: readonly string[],
): void {
  const { input, line } = editableTransfer(state, sourceLineId);
  assertEditableTransferQuantity({ ...input, rejectedLineIds }, sourceLineId, line.qty);
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
          operatorReview: {
            config: state.rebalance.config,
            rejectedLineIds: state.rebalance.rejectedLineIds,
          },
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
