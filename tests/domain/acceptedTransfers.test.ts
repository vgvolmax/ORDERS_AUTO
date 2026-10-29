import { describe, expect, it } from 'vitest';
import {
  acceptTransfers,
  revokeTransfers,
} from '../../src/domain/rebalancing/acceptedTransfers';
import {
  ALGORITHM_VERSION,
  calculateRebalance,
} from '../../src/domain/rebalancing/calculate';
import {
  branchParticipationFingerprint,
  rebalanceConfigFingerprint,
} from '../../src/domain/rebalancing/constraints';
import type {
  AcceptTransfersInput,
  AcceptedTransfer,
  RebalanceProposal,
} from '../../src/domain/rebalancing/types';
import { config, snapshot } from '../fixtures/rebalanceFixtures';

function acceptance(): AcceptTransfersInput {
  const data = snapshot();
  data.branches.push({
    id: 'D2',
    name: 'Второй донор',
    active: true,
    aliases: [],
  });
  data.stocks[0]!.stock = 75;
  data.stocks.push({
    skuCode: '00001',
    branchId: 'D2',
    stock: 95,
    min: 20,
    max: 60,
    sourceRow: 9,
  });
  const settings = config();
  const proposal: RebalanceProposal = {
    runId: 'run1',
    createdAt: '2026-10-20T13:00:00Z',
    snapshotId: data.snapshotId,
    baseAcceptedRevision: 0,
    configFingerprint: rebalanceConfigFingerprint(settings),
    config: settings,
    inputFingerprint: 'fixture',
    algorithmVersion: ALGORITHM_VERSION,
    participationFingerprint: branchParticipationFingerprint(data.branches),
    eligibleRecipientKeys: ['["00001","R"]'],
    transfers: [
      {
        sourceLineId: 'line1',
        skuCode: '00001',
        fromBranchId: 'D',
        toBranchId: 'R',
        qty: 15,
      },
      {
        sourceLineId: 'line2',
        skuCode: '00001',
        fromBranchId: 'D2',
        toBranchId: 'R',
        qty: 20,
      },
    ],
    balances: [],
    exclusions: [],
    uncoveredNeed: [],
  };
  return {
    snapshot: data,
    currentAccepted: [],
    currentProposal: proposal,
    selectedLineIds: ['line1'],
    currentRevision: 0,
    expectedRevision: 0,
    currentConfigFingerprint: proposal.configFingerprint,
    acceptedAt: '2026-10-20T13:01:00Z',
    transferIdBySourceLineId: { line1: 'transfer1', line2: 'transfer2' },
  };
}
function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'NO_ERROR';
}
function acceptFirst(): {
  input: AcceptTransfersInput;
  accepted: AcceptedTransfer[];
} {
  const input = acceptance();
  return { input, accepted: acceptTransfers(input).nextAccepted };
}

describe('explicit accepted movement ledger', () => {
  it('applies only selected rows, freezes a copy of config and preserves all inputs', () => {
    const input = acceptance();
    const before = structuredClone(input);
    const out = acceptTransfers(input);
    expect(out.nextAccepted).toHaveLength(1);
    expect(out.nextAccepted[0]).toMatchObject({
      transferId: 'transfer1',
      qty: 15,
      fromBranchId: 'D',
      toBranchId: 'R',
    });
    expect(out.nextRevision).toBe(1);
    expect(out.changedSkuBranchKeys).toEqual([
      '["00001","D"]',
      '["00001","R"]',
    ]);
    expect(input).toEqual(before);
    input.currentProposal.config.receiverPct = 0;
    expect(out.nextAccepted[0]!.acceptedConfig.receiverPct).toBe(100);
  });
  it('selection alone and repeated acceptance are no-ops', () => {
    const input = acceptance();
    input.selectedLineIds = [];
    expect(acceptTransfers(input)).toEqual({
      nextAccepted: [],
      changedSkuBranchKeys: [],
      nextRevision: 0,
      diagnostics: [],
    });
    const first = acceptTransfers({
      ...input,
      selectedLineIds: ['line1', 'line1'],
    });
    const repeated = acceptTransfers({
      ...input,
      currentAccepted: first.nextAccepted,
      selectedLineIds: ['line1'],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(repeated.nextAccepted).toHaveLength(1);
    expect(repeated.nextRevision).toBe(1);
    expect(repeated.changedSkuBranchKeys).toEqual([]);
  });
  it('allows remaining lines in the same run even after accepted input raised recipient above Min', () => {
    const { input, accepted } = acceptFirst();
    const next = acceptTransfers({
      ...input,
      currentAccepted: accepted,
      selectedLineIds: ['line2'],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(next.nextAccepted.map((t) => t.qty)).toEqual([15, 20]);
    expect(next.nextRevision).toBe(2);
  });
  it('revokes only named IDs and does not increment on a repeated revoke', () => {
    const input = acceptance();
    input.selectedLineIds = ['line1', 'line2'];
    const accepted = acceptTransfers(input).nextAccepted;
    const out = revokeTransfers({
      snapshot: input.snapshot,
      currentAccepted: accepted,
      transferIds: ['transfer1'],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(out.nextAccepted.map((t) => t.transferId)).toEqual(['transfer2']);
    expect(
      revokeTransfers({
        snapshot: input.snapshot,
        currentAccepted: out.nextAccepted,
        transferIds: ['transfer1'],
        currentRevision: 2,
        expectedRevision: 2,
      }).nextRevision,
    ).toBe(2);
  });
  it.each(['revision', 'snapshot', 'config', 'unknown-line'] as const)(
    'rejects stale %s without side effects',
    (kind) => {
      const input = acceptance();
      if (kind === 'revision') input.expectedRevision = 5;
      if (kind === 'snapshot') input.currentProposal.snapshotId = 'other';
      if (kind === 'config') input.currentConfigFingerprint = 'other';
      if (kind === 'unknown-line') input.selectedLineIds = ['missing'];
      const before = structuredClone(input);
      expect(errorCode(() => acceptTransfers(input))).toBe(
        kind === 'revision' ? 'REVISION_CONFLICT' : 'STALE_PROPOSAL',
      );
      expect(input).toEqual(before);
    },
  );
  it('checks the entire selected batch and accepted inventory against donor Max, without spending incoming stock', () => {
    const input = acceptance();
    input.currentProposal.transfers[0]!.qty = 16;
    expect(errorCode(() => acceptTransfers(input))).toBe(
      'INVALID_TRANSFER_BATCH',
    );
    const other = acceptance();
    other.currentProposal.transfers[0]!.fromBranchId = 'R';
    other.currentProposal.transfers[0]!.toBranchId = 'D';
    expect(errorCode(() => acceptTransfers(other))).toBe(
      'INVALID_TRANSFER_BATCH',
    );
  });
  it.each([0, -1, NaN, 0.5, 51])(
    'rejects invalid transfer quantity %s or recipient overflow atomically',
    (qty) => {
      const input = acceptance();
      input.currentProposal.transfers[0]!.qty = qty;
      expect(errorCode(() => acceptTransfers(input))).toBe(
        'INVALID_TRANSFER_BATCH',
      );
      expect(input.currentAccepted).toEqual([]);
    },
  );
  it('detects transfer identity collisions instead of treating different moves as a retry', () => {
    const { input, accepted } = acceptFirst();
    const next = {
      ...input,
      currentAccepted: accepted,
      selectedLineIds: ['line2'],
      currentRevision: 1,
      expectedRevision: 1,
      transferIdBySourceLineId: { line2: 'transfer1' },
    };
    expect(errorCode(() => acceptTransfers(next))).toBe('TRANSFER_ID_CONFLICT');
    input.currentProposal.transfers[0]!.qty = 14;
    expect(
      errorCode(() =>
        acceptTransfers({
          ...input,
          currentAccepted: accepted,
          currentRevision: 1,
          expectedRevision: 1,
        }),
      ),
    ).toBe('TRANSFER_ID_CONFLICT');
  });
  it('rechecks SKU total on the accepted subset and permits explicit revocation below the threshold', () => {
    const input = acceptance();
    input.currentProposal.config.skuAmountFilter = {
      enabled: true,
      threshold: 10000,
    };
    input.currentProposal.transfers[0]!.qty = 6;
    input.currentProposal.transfers[1]!.qty = 5;
    input.currentConfigFingerprint = input.currentProposal.configFingerprint =
      rebalanceConfigFingerprint(input.currentProposal.config);
    expect(errorCode(() => acceptTransfers(input))).toBe(
      'INVALID_TRANSFER_BATCH',
    );
    const all = acceptTransfers({
      ...input,
      selectedLineIds: ['line1', 'line2'],
    });
    expect(all.nextAccepted.map((t) => t.qty)).toEqual([6, 5]);
    const revoked = revokeTransfers({
      snapshot: input.snapshot,
      currentAccepted: all.nextAccepted,
      transferIds: ['transfer2'],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(revoked.nextAccepted[0]!.qty).toBe(6);
  });
  it.each([10000, 7200])(
    'reports retained accepted value at or below its strict threshold %s after revoke',
    (threshold) => {
      const input = acceptance();
      input.currentProposal.config.skuAmountFilter = {
        enabled: true,
        threshold,
      };
      input.currentProposal.transfers[0]!.qty = 6;
      input.currentProposal.transfers[1]!.qty = 5;
      input.currentConfigFingerprint = input.currentProposal.configFingerprint =
        rebalanceConfigFingerprint(input.currentProposal.config);
      const all = acceptTransfers({
        ...input,
        selectedLineIds: ['line1', 'line2'],
      });
      expect(all.diagnostics).toEqual([]);
      const revoked = revokeTransfers({
        snapshot: input.snapshot,
        currentAccepted: all.nextAccepted,
        transferIds: ['transfer2'],
        currentRevision: 1,
        expectedRevision: 1,
      });
      const warning = expect.objectContaining({
        code: 'ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD',
        severity: 'WARNING',
        sourceRunId: 'run1',
        skuCode: '00001',
        quantity: 6,
        amount: 7200,
        threshold,
      });
      expect(revoked.nextAccepted.map((t) => t.qty)).toEqual([6]);
      expect(revoked.diagnostics).toEqual([warning]);
      const recalculated = calculateRebalance(
        input.snapshot,
        input.currentProposal.config,
        revoked.nextAccepted,
      );
      expect(recalculated.transfers.length).toBeGreaterThan(0); // A new proposal must not mask the accepted run warning.
      expect(recalculated.exclusions).toContainEqual(warning);
      const unchanged = revokeTransfers({
        snapshot: input.snapshot,
        currentAccepted: revoked.nextAccepted,
        transferIds: ['missing'],
        currentRevision: 2,
        expectedRevision: 2,
      });
      expect(unchanged.nextRevision).toBe(2);
      expect(unchanged.diagnostics).toEqual([warning]);
      const restored = acceptTransfers({
        ...input,
        currentAccepted: revoked.nextAccepted,
        selectedLineIds: ['line2'],
        currentRevision: 2,
        expectedRevision: 2,
      });
      expect(restored.diagnostics).toEqual([]);
      const cleared = revokeTransfers({
        snapshot: input.snapshot,
        currentAccepted: revoked.nextAccepted,
        transferIds: ['transfer1'],
        currentRevision: 2,
        expectedRevision: 2,
      });
      expect(cleared.diagnostics).toEqual([]);
    },
  );
  it('keeps retained economic diagnostics separate by run and uses saved acceptance conditions', () => {
    const input = acceptance();
    input.currentProposal.config.recipientTrigger = 'BELOW_MAX';
    input.currentProposal.config.skuAmountFilter = {
      enabled: true,
      threshold: 10000,
    };
    input.currentProposal.transfers[0]!.qty = 6;
    input.currentProposal.transfers[1]!.qty = 5;
    input.currentConfigFingerprint = input.currentProposal.configFingerprint =
      rebalanceConfigFingerprint(input.currentProposal.config);
    const first = acceptTransfers({
      ...input,
      selectedLineIds: ['line1', 'line2'],
    });
    const secondProposal = structuredClone(input.currentProposal);
    secondProposal.runId = 'run2';
    secondProposal.baseAcceptedRevision = 1;
    secondProposal.config.skuAmountFilter.threshold = 12000;
    secondProposal.configFingerprint = rebalanceConfigFingerprint(
      secondProposal.config,
    );
    const second = acceptTransfers({
      ...input,
      currentProposal: secondProposal,
      currentConfigFingerprint: secondProposal.configFingerprint,
      currentAccepted: first.nextAccepted,
      selectedLineIds: ['line1', 'line2'],
      currentRevision: 1,
      expectedRevision: 1,
      transferIdBySourceLineId: { line1: 'second1', line2: 'second2' },
    });
    const remaining = revokeTransfers({
      snapshot: input.snapshot,
      currentAccepted: second.nextAccepted,
      transferIds: ['transfer2', 'second1'],
      currentRevision: 2,
      expectedRevision: 2,
    });
    expect(remaining.diagnostics).toEqual([
      expect.objectContaining({
        sourceRunId: 'run1',
        quantity: 6,
        amount: 7200,
        threshold: 10000,
      }),
      expect.objectContaining({
        sourceRunId: 'run2',
        quantity: 5,
        amount: 6000,
        threshold: 12000,
      }),
    ]);
    const currentSettings = config(); // Disabling today's filter must not erase saved conditions of either run.
    expect(
      calculateRebalance(
        input.snapshot,
        currentSettings,
        remaining.nextAccepted,
      ).exclusions,
    ).toEqual(expect.arrayContaining(remaining.diagnostics));
  });
  it('uses exact monetary comparison for retained accepted amounts at a decimal threshold', () => {
    const input = acceptance();
    input.snapshot.skus[0]!.referencePrice = 0.1;
    input.currentProposal.config.skuAmountFilter = {
      enabled: true,
      threshold: 0.3,
    };
    input.currentProposal.transfers[0]!.qty = 3;
    input.currentProposal.transfers[1]!.qty = 1;
    input.currentConfigFingerprint = input.currentProposal.configFingerprint =
      rebalanceConfigFingerprint(input.currentProposal.config);
    const all = acceptTransfers({
      ...input,
      selectedLineIds: ['line1', 'line2'],
    });
    const remaining = revokeTransfers({
      snapshot: input.snapshot,
      currentAccepted: all.nextAccepted,
      transferIds: ['transfer2'],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(remaining.diagnostics).toEqual([
      expect.objectContaining({
        code: 'ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD',
        quantity: 3,
        threshold: 0.3,
      }),
    ]);
  });
  it('compares monetary thresholds exactly for decimal prices', () => {
    const input = acceptance();
    input.snapshot.skus[0]!.quantityStep = 0.1;
    input.snapshot.skus[0]!.referencePrice = 0.1;
    input.currentProposal.transfers[0]!.qty = 3;
    input.currentProposal.config.skuAmountFilter = {
      enabled: true,
      threshold: 0.3,
    };
    input.currentConfigFingerprint = input.currentProposal.configFingerprint =
      rebalanceConfigFingerprint(input.currentProposal.config);
    expect(errorCode(() => acceptTransfers(input))).toBe(
      'INVALID_TRANSFER_BATCH',
    );
  });
});
