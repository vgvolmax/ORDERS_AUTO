import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import {
  acceptTransfers,
  revokeTransfers,
} from '../../src/domain/rebalancing/acceptedTransfers';
import {
  branchParticipationFingerprint,
  rebalanceConfigFingerprint,
} from '../../src/domain/rebalancing/constraints';
import { createRebalanceSnapshot } from '../../src/import/rebalanceSnapshot';
import type {
  AcceptedTransfer,
  RebalanceProposal,
  RebalanceSnapshot,
} from '../../src/domain/rebalancing/types';
import { config } from '../fixtures/rebalanceFixtures';

function network(capacities = [12, 0], needs = [8, 6]): RebalanceSnapshot {
  const ids = ['D1', 'D2', 'R1', 'R2'];
  return {
    schemaVersion: 1,
    snapshotId: 'full',
    branches: ids.map((id) => ({ id, name: id, active: true, aliases: [] })),
    skus: [
      {
        skuCode: 'sku',
        name: 'SKU',
        unit: 'шт',
        quantityStep: 1,
        referencePrice: 10,
      },
    ],
    stocks: ids.map((branchId, i) => ({
      skuCode: 'sku',
      branchId,
      stock: i < 2 ? 10 + capacities[i]! : 0,
      min: i < 2 ? 10 : needs[i - 2]!,
      max: i < 2 ? 10 : needs[i - 2]!,
      sourceRow: i + 1,
    })),
  };
}
const routes = (pairs: string[][]) =>
  config({
    routeConfig: {
      mode: 'SELECTIVE',
      pairs: pairs.map(([branchAId, branchBId]) => ({
        branchAId: branchAId!,
        branchBId: branchBId!,
        direction: 'A_TO_B',
      })),
    },
  });
const total = (
  s: RebalanceSnapshot,
  c = config(),
  accepted: AcceptedTransfer[] = [],
) => calculateRebalance(s, c, accepted);
const diagnostic = (out: ReturnType<typeof total>) =>
  (out as unknown as { skippedSkus: unknown[] }).skippedSkus;
function proposal(s: RebalanceSnapshot): RebalanceProposal {
  const c = config();
  return {
    ...total(s, c),
    runId: 'run',
    createdAt: '2026-10-29T00:00:00Z',
    snapshotId: s.snapshotId,
    baseAcceptedRevision: 0,
    config: c,
    configFingerprint: rebalanceConfigFingerprint(c),
  };
}
function accept(
  s: RebalanceSnapshot,
  p: RebalanceProposal,
  currentAccepted: AcceptedTransfer[] = [],
  selectedLineIds = p.transfers.map((t) => t.sourceLineId),
) {
  return acceptTransfers({
    snapshot: s,
    currentProposal: p,
    currentAccepted,
    selectedLineIds,
    currentRevision: currentAccepted.length,
    expectedRevision: currentAccepted.length,
    currentConfigFingerprint: p.configFingerprint,
    acceptedAt: '2026-10-29T01:00:00Z',
    transferIdBySourceLineId: Object.fromEntries(
      p.transfers.map((t, i) => [t.sourceLineId, `t${i}`]),
    ),
  });
}
describe('partial-network coverage and independent purchasing residuals', () => {
  it('proposes twelve legal units even when the network needs fourteen', () => {
    const out = total(network());
    expect(out.transfers.reduce((sum, t) => sum + t.qty, 0)).toBe(12);
    expect(diagnostic(out)).toEqual([
      expect.objectContaining({
        skuCode: 'sku',
        neededQty: 14,
        deliverableQty: 12,
        missingQty: 2,
        reason: 'INSUFFICIENT_SURPLUS',
      }),
    ]);
    expect(out.balances.reduce((sum, b) => sum + b.proposedIncoming, 0)).toBe(12);
    expect(out.uncoveredNeed.reduce((sum, r) => sum + r.toTarget, 0)).toBe(2);
  });
  it('combines multiple donors and emits no active allocation fields', () => {
    const out = total(network([8, 6]));
    expect(out.transfers.reduce((n, t) => n + t.qty, 0)).toBe(14);
    expect(diagnostic(out)).toEqual([]);
    expect(Object.keys(out).some((key) => key.startsWith('allocation'))).toBe(
      false,
    );
  });
  it('still moves reachable units when a route cut prevents full coverage', () => {
    const s = network([16, 4]);
    for (const pairs of [
      [
        ['D1', 'R1'],
        ['D2', 'R2'],
      ],
      [
        ['D1', 'R1'],
        ['D2', 'R1'],
        ['D2', 'R2'],
      ],
    ]) {
      const out = total(s, routes(pairs));
      expect(out.transfers.reduce((sum, t) => sum + t.qty, 0)).toBe(12);
      expect(diagnostic(out)).toEqual([
        expect.objectContaining({
          neededQty: 14,
          deliverableQty: 12,
          missingQty: 2,
          reason: 'ROUTE_LIMIT',
        }),
      ]);
    }
  });
  it('selects recipients with zero-surplus inbound, while fully closed inbound intentionally excludes', () => {
    const s = network([8, 0]);
    expect(
      total(
        s,
        routes([
          ['D1', 'R1'],
          ['D2', 'R2'],
        ]),
      ).transfers.map((t) => t.qty),
    ).toEqual([8]);
    expect(
      total(s, routes([['D1', 'R1']])).transfers.map((t) => t.qty),
    ).toEqual([8]);
  });
  it('moves the allowed step even if a fractional remainder cannot be moved', () => {
    const s = network([1, 0], [0.3, 0]);
    s.skus[0]!.quantityStep = 0.2;
    const out = total(s);
    expect(out.transfers.map((t) => t.qty)).toEqual([0.2]);
    expect(diagnostic(out)).toEqual([
      expect.objectContaining({
        neededQty: 0.3,
        deliverableQty: 0.2,
        missingQty: 0.1,
        reason: 'QUANTITY_STEP',
      }),
    ]);
  });
  it('does not silently remove invalid selected demand, directly or through the import adapter', () => {
    const s = network([20, 0]);
    s.stocks[3]!.min = null;
    expect(total(s).transfers).toEqual([]);
    const built = createRebalanceSnapshot({
      snapshotId: s.snapshotId,
      branchRegistry: s.branches,
      skuPolicies: [{ skuCode: 'sku', unit: 'шт', quantityStep: 1 }],
      dataset: {
        branches: s.branches.map((b) => b.name),
        skus: [
          {
            code: 'sku',
            name: 'SKU',
            article: null,
            referencePrice: 10,
            reportedTotalStock: null,
          },
        ],
        branchStocks: s.stocks.map((r) => ({
          skuCode: r.skuCode,
          branch: r.branchId,
          stock: r.stock,
          min: r.min,
          max: r.max,
        })),
      },
    });
    expect(total(built.snapshot).transfers).toEqual([]);
  });
  it('keeps parser-removed invalid selected demand from certifying the remaining SKU', () => {
    const s = network([20, 0]);
    const built = createRebalanceSnapshot({
      snapshotId: s.snapshotId,
      branchRegistry: s.branches,
      skuPolicies: [{ skuCode: 'sku', unit: 'шт', quantityStep: 1 }],
      sourceIssues: [
        {
          code: 'DUPLICATE_SKU_BRANCH',
          message: 'duplicate',
          severity: 'ERROR',
          skuCode: 'sku',
          branch: 'R2',
          row: 7,
        },
      ],
      dataset: {
        branches: s.branches.map((b) => b.name),
        skus: [
          {
            code: 'sku',
            name: 'SKU',
            article: null,
            referencePrice: 10,
            reportedTotalStock: null,
          },
        ],
        branchStocks: s.stocks
          .filter((r) => r.branchId !== 'R2')
          .map((r) => ({
            skuCode: r.skuCode,
            branch: r.branchId,
            stock: r.stock,
            min: r.min,
            max: r.max,
          })),
      },
    });
    expect(total(built.snapshot).transfers).toEqual([]);
    expect(total(built.snapshot).exclusions).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_SKU_BRANCH' }),
    );
  });
  it('does not let an invalid inactive branch veto valid active recipient coverage', () => {
    const s = network([8, 0], [8, 6]);
    s.branches[3]!.active = false;
    s.validationIssues = [
      {
        code: 'DUPLICATE_SKU_BRANCH',
        message: 'duplicate',
        severity: 'ERROR',
        sourceRow: 7,
        skuCode: 'sku',
        branchId: 'R2',
      },
    ];
    const out = total(s);
    expect(out.transfers.map((t) => t.qty)).toEqual([8]);
    expect(out.exclusions).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_SKU_BRANCH' }),
    );
  });
  it('reserves accepted5 and proposes exactly remaining9 with stable permutations', () => {
    const s = network([14, 0]);
    const p = proposal(s);
    const first = p.transfers[0]!;
    const accepted: AcceptedTransfer[] = [
      {
        transferId: 'old',
        sourceRunId: 'old',
        sourceLineId: 'old',
        skuCode: first.skuCode,
        fromBranchId: first.fromBranchId,
        toBranchId: first.toBranchId,
        qty: 5,
        snapshotId: s.snapshotId,
        acceptedAt: '2026-10-29T00:00:00Z',
        acceptedConfig: config(),
      },
    ];
    const out = total(s, config(), accepted);
    expect(out.transfers.reduce((n, t) => n + t.qty, 0)).toBe(9);
    s.branches.reverse();
    s.stocks.reverse();
    expect(total(s, config(), [...accepted].reverse())).toEqual(out);
  });
  it.each(['legacy', 'missing-signature'])(
    'blocks %s fresh additions but allows historical no-op and revoke',
    (kind) => {
      const s = network([14, 0]);
      const p = proposal(s);
      const accepted = accept(s, p).nextAccepted;
      if (kind === 'legacy') p.algorithmVersion = 'legacy';
      else delete p.participationFingerprint;
      expect(() => accept(s, p)).toThrow('STALE_PROPOSAL');
      expect(accept(s, p, accepted).nextAccepted).toEqual(accepted);
      expect(
        revokeTransfers({
          snapshot: s,
          currentAccepted: accepted,
          transferIds: accepted.map((t) => t.transferId),
          currentRevision: 1,
          expectedRevision: 1,
        }).nextAccepted,
      ).toEqual([]);
    },
  );
  it('preserves inactive physical rows/ledger but guards new acceptance and participation changes', () => {
    const s = network([14, 0]);
    const p = proposal(s);
    const accepted = accept(s, p).nextAccepted;
    s.branches[0]!.active = false;
    expect(() => accept(s, p)).toThrow('STALE_PROPOSAL');
    expect(accept(s, p, accepted).nextAccepted).toEqual(accepted);
    p.participationFingerprint = branchParticipationFingerprint(s.branches);
    expect(() => accept(s, p)).toThrow('INVALID_TRANSFER_BATCH');
    expect(total(s, config(), accepted).balances).toHaveLength(4);
    expect(
      revokeTransfers({
        snapshot: s,
        currentAccepted: accepted,
        transferIds: accepted.map((t) => t.transferId),
        currentRevision: 1,
        expectedRevision: 1,
      }).nextAccepted,
    ).toEqual([]);
    expect(total(s).transfers).toEqual([]);
  });
  it('does not invalidate remaining lines merely because a subset was accepted', () => {
    const s = network([8, 6]);
    const p = proposal(s);
    const first = accept(s, p, [], [p.transfers[0]!.sourceLineId]);
    expect(
      accept(s, p, first.nextAccepted).nextAccepted.reduce(
        (n, t) => n + t.qty,
        0,
      ),
    ).toBe(14);
  });
});

it('applies the amount threshold even when there is not enough physical stock for the network', () => {
  for (const threshold of [130, 60]) {
    const out = calculateRebalance(
      network(),
      config({ transferAmountFilter: { enabled: true, threshold } }),
      [],
    );
    const moved = out.transfers.reduce((sum, t) => sum + t.qty, 0);
    expect(moved).toBe(threshold === 130 ? 0 : 12);
    expect(out.skippedSkus).toEqual([
      expect.objectContaining({
        neededQty: 14,
        deliverableQty: moved,
        missingQty: 14 - moved,
        reason: threshold === 130 ? 'AMOUNT_THRESHOLD' : 'INSUFFICIENT_SURPLUS',
      }),
    ]);
  }
});
