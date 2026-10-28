import {
  RebalanceError,
  type AcceptedTransfer,
  type BranchRegistry,
  type DonorAcceptanceScope,
  type DonorPriorityLevels,
  type RebalanceProposal,
} from './types';

export function validateDonorPriorityLevels(
  registry: BranchRegistry,
  donor: string,
  levels: DonorPriorityLevels,
): DonorPriorityLevels {
  const active = new Set(registry.filter((b) => b.active).map((b) => b.id));
  const seen = new Set<string>();
  if (!active.has(donor) || !Array.isArray(levels) || levels.length !== 3)
    throw new RebalanceError('INVALID_TRANSFER_BATCH');
  for (const level of levels) {
    if (!Array.isArray(level))
      throw new RebalanceError('INVALID_TRANSFER_BATCH');
    for (const id of level) {
      if (id === donor || !active.has(id) || seen.has(id))
        throw new RebalanceError('INVALID_TRANSFER_BATCH');
      seen.add(id);
    }
  }
  return levels.map((level) => [...level].sort()) as DonorPriorityLevels;
}

/** Resolve from the committed proposal after the save barrier, never from filtered UI rows. */
export function donorAcceptanceIds(
  input: {
    proposal: RebalanceProposal | null;
    accepted: AcceptedTransfer[];
    rejectedLineIds?: readonly string[];
  },
  scope: DonorAcceptanceScope,
): string[] {
  const p = input.proposal;
  if (!p) return [];
  const accepted = new Set(
    input.accepted
      .filter((t) => t.sourceRunId === p.runId)
      .map((t) => t.sourceLineId),
  );
  const rejected = new Set(input.rejectedLineIds);
  const recipients =
    scope.priority === null
      ? null
      : new Set(
          p.allocationPriorityLevels?.[scope.fromBranchId]?.[scope.priority] ??
            [],
        );
  return [
    ...new Set(
      p.transfers
        .filter(
          (t) =>
            t.fromBranchId === scope.fromBranchId &&
            t.qty > 0 &&
            !accepted.has(t.sourceLineId) &&
            !rejected.has(t.sourceLineId) &&
            (!recipients || recipients.has(t.toBranchId)),
        )
        .map((t) => t.sourceLineId),
    ),
  ];
}
