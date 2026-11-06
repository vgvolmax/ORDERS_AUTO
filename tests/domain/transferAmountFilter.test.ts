import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import {
  acceptTransfers,
  revokeTransfers,
} from '../../src/domain/rebalancing/acceptedTransfers';
import { acceptedEconomicDiagnostics } from '../../src/domain/rebalancing/economics';
import { rebalanceConfigFingerprint } from '../../src/domain/rebalancing/constraints';
import type {
  AcceptedTransfer,
  RebalanceConfig,
  RebalanceProposal,
  RebalanceSnapshot,
} from '../../src/domain/rebalancing/types';
import { config } from '../fixtures/rebalanceFixtures';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import {
  createProposal,
  prepareAcceptedChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';

// Each SKU has one recipient and up to two physical donors; no fake intermediate stock.
function network(
  items: Array<[string, number | null, number, number]>,
): RebalanceSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: 'documents',
    branches: ['D', 'D2', 'R'].map((id) => ({
      id,
      name: id,
      active: true,
      aliases: [],
    })),
    skus: items.map(([skuCode, referencePrice]) => ({
      skuCode,
      name: skuCode,
      referencePrice,
      unit: 'шт',
      quantityStep: 1,
    })),
    stocks: items.flatMap(([skuCode, , first, second]) => [
      {
        skuCode,
        branchId: 'D',
        stock: 100 + first,
        min: 0,
        max: 100,
        sourceRow: 1,
      },
      {
        skuCode,
        branchId: 'D2',
        stock: 100 + second,
        min: 0,
        max: 100,
        sourceRow: 2,
      },
      {
        skuCode,
        branchId: 'R',
        stock: 0,
        min: first + second,
        max: first + second,
        sourceRow: 3,
      },
    ]),
  };
}
const settings = (threshold = 5000) =>
  config({ transferAmountFilter: { enabled: true, threshold } });
function plan(
  s: RebalanceSnapshot,
  c = settings(),
  accepted: AcceptedTransfer[] = [],
): RebalanceProposal {
  return {
    ...calculateRebalance(s, c, accepted),
    runId: 'run',
    snapshotId: s.snapshotId,
    createdAt: '2026-11-03T09:00:00Z',
    baseAcceptedRevision: 0,
    config: c,
    configFingerprint: rebalanceConfigFingerprint(c),
  };
}
function accept(
  s: RebalanceSnapshot,
  p: RebalanceProposal,
  ids = p.transfers.map((t) => t.sourceLineId),
  current: AcceptedTransfer[] = [],
) {
  return acceptTransfers({
    snapshot: s,
    currentProposal: p,
    currentAccepted: current,
    selectedLineIds: ids,
    currentRevision: current.length ? 1 : 0,
    expectedRevision: current.length ? 1 : 0,
    currentConfigFingerprint: p.configFingerprint,
    acceptedAt: '2026-11-03T09:01:00Z',
    transferIdBySourceLineId: Object.fromEntries(
      p.transfers.map((t, i) => [t.sourceLineId, 't' + i]),
    ),
  });
}

describe('minimum amount belongs to one SKU from one donor to one recipient', () => {
  it('does not combine different small SKUs even inside the same directed document', () => {
    const s = network([
      ['A', 1000, 2, 0],
      ['B', 1000, 2, 0],
      ['C', 1500, 1, 0],
    ]);
    expect(plan(s).transfers).toEqual([]);
  });
  it('removes a small donor document but retains the other eight units and the remaining need of two', () => {
    const s = network([['A', 1000, 8, 2]]),
      p = plan(s);
    expect(p.transfers.map((t) => [t.fromBranchId, t.qty])).toEqual([['D', 8]]);
    expect(p.balances.find((b) => b.branchId === 'R')!.stockAfter).toBe(8);
    expect(p.balances.find((b) => b.branchId === 'D2')!.stockAfter).toBe(102);
    expect(p.uncoveredNeed).toContainEqual({
      skuCode: 'A',
      branchId: 'R',
      toMin: 2,
      toTarget: 2,
    });
    expect(p.skippedSkus).toEqual([expect.objectContaining({
      neededQty: 10, deliverableQty: 8, missingQty: 2,
      reason: 'AMOUNT_THRESHOLD',
    })]);
    expect(p.exclusions).toContainEqual(
      expect.objectContaining({
        code: 'TRANSFER_AMOUNT_FILTER',
        fromBranchId: 'D2',
        toBranchId: 'R',
        amount: 2000,
        threshold: 5000,
      }),
    );
    expect(accept(s, p).nextAccepted.map((t) => t.qty)).toEqual([8]);
  });
  it('does not combine two small senders to finance either document', () => {
    const p = plan(network([['A', 1000, 3, 3]]));
    expect(p.transfers).toEqual([]);
    expect(
      p.exclusions.filter((i) => i.code === 'TRANSFER_AMOUNT_FILTER'),
    ).toHaveLength(2);
  });
  it('does not combine separate recipients of the same donor', () => {
    const s = network([['A', 1000, 6, 0]]);
    s.branches.push({ id: 'R2', name: 'R2', active: true, aliases: [] });
    s.stocks.find((r) => r.branchId === 'R')!.min = 3;
    s.stocks.find((r) => r.branchId === 'R')!.max = 3;
    s.stocks.push({
      skuCode: 'A',
      branchId: 'R2',
      stock: 0,
      min: 3,
      max: 3,
      sourceRow: 4,
    });
    expect(plan(s).transfers).toEqual([]);
  });
  it.each([
    [1000, 5000, 5],
    [0.1, 0.3, 3],
  ] as const)(
    'includes exact equality at price%s and threshold%s',
    (price, threshold, qty) => {
      const s = network([['A', price, qty, 0]]),
        p = plan(s, settings(threshold));
      expect(p.transfers[0]!.qty).toBe(qty);
      expect(accept(s, p).nextAccepted[0]!.qty).toBe(qty);
    },
  );
  it('does not round a genuinely subthreshold price up', () => {
    expect(
      plan(network([['A', 0.099999999, 3, 0]]), settings(0.3)).transfers,
    ).toEqual([]);
  });
  it('moves a qualifying eight even when the recipient still needs two', () => {
    const s = network([['A', 1000, 8, 2]]);
    s.stocks.find((r) => r.branchId === 'D2')!.stock = 100;
    const p = plan(s);
    expect(p.transfers.map((t) => t.qty)).toEqual([8]);
    expect(p.skippedSkus).toContainEqual(
      expect.objectContaining({
        deliverableQty: 8,
        missingQty: 2,
        reason: 'INSUFFICIENT_SURPLUS',
      }),
    );
  });
  it('does not allow another SKU to finance a small accepted line', () => {
    const s = network([
        ['A', 1000, 8, 0],
        ['B', 1000, 8, 0],
      ]),
      p = plan(s);
    p.transfers.find((t) => t.skuCode === 'B')!.qty = 2;
    expect(() => accept(s, p)).toThrow('INVALID_TRANSFER_BATCH');
  });
  it('warns about the retained amount of the same SKU and directed pair after revoke', () => {
    const s = network([['A', 1000, 10, 0]]),
      p = plan(s, settings(8000));
    const line = p.transfers[0]!;
    p.transfers = [
      { ...line, sourceLineId: 'first', qty: 6 },
      { ...line, sourceLineId: 'second', qty: 4 },
    ];
    const all = accept(s, p);
    expect(all.diagnostics).toEqual([]);
    const rest = revokeTransfers({
      snapshot: s,
      currentAccepted: all.nextAccepted,
      transferIds: [all.nextAccepted[1]!.transferId],
      currentRevision: 1,
      expectedRevision: 1,
    });
    expect(rest.diagnostics).toEqual([
      expect.objectContaining({
        code: 'ACCEPTED_TRANSFER_AMOUNT_BELOW_THRESHOLD',
        skuCode: 'A',
        fromBranchId: 'D',
        toBranchId: 'R',
        amount: 6000,
        threshold: 8000,
      }),
    ]);
  });
  it('retains the legacy live threshold and marks new accepted conditions explicitly', () => {
    const c = config({ skuAmountFilter: { enabled: true, threshold: 5000 } });
    const s = network([
        ['A', 1000, 6, 0],
        ['B', 1000, 6, 0],
      ]),
      p = plan(s, c);
    expect(p.transfers).toHaveLength(2);
    expect(
      accept(s, p).nextAccepted[0]!.acceptedConfig.transferAmountFilter,
    ).toEqual({ enabled: true, threshold: 5000 });
  });
  it('ignores the removed unit-price filter in new calculations and acceptance', () => {
    const s = network([['A', 1000, 8, 0]]),
      c = settings();
    c.unitPriceFilter = { enabled: true, threshold: 1000000 };
    const p = plan(s, c);
    expect(p.transfers.map((t) => t.qty)).toEqual([8]);
    expect(accept(s, p).nextAccepted.map((t) => t.qty)).toEqual([8]);
  });
  it('leaves historical accepted SKU conditions readable and does not reinterpret them', () => {
    const s = network([
      ['A', 1000, 3, 0],
      ['B', 1000, 3, 0],
    ]);
    const legacy = s.skus.map(
      (sku, i): AcceptedTransfer => ({
        transferId: 't' + i,
        sourceRunId: 'old',
        sourceLineId: 'l' + i,
        skuCode: sku.skuCode,
        fromBranchId: 'D',
        toBranchId: 'R',
        qty: 3,
        snapshotId: s.snapshotId,
        acceptedAt: '2026-11-03T08:00:00Z',
        acceptedConfig: config({
          skuAmountFilter: { enabled: true, threshold: 5000 },
        }),
      }),
    );
    expect(acceptedEconomicDiagnostics(s, legacy).map((i) => i.code)).toEqual([
      'ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD',
      'ACCEPTED_SKU_AMOUNT_BELOW_THRESHOLD',
    ]);
    expect(plan(s, config(), legacy).transfers).toEqual([]);
  });
  it('keeps unknown prices excluded only when a monetary filter is active', () => {
    const s = network([['A', null, 10, 0]]);
    expect(plan(s).transfers).toEqual([]);
    expect(plan(s).exclusions).toContainEqual(
      expect.objectContaining({
        code: 'TRANSFER_AMOUNT_UNKNOWN',
        skuCode: 'A',
        fromBranchId: 'D',
        toBranchId: 'R',
        amount: null,
        threshold: 5000,
      }),
    );
    expect(plan(s, config()).transfers).toHaveLength(1);
    expect(plan(network([['A', 0, 1, 0]]), settings(0)).transfers).toHaveLength(
      1,
    );
  });
  it('keeps ten units in purchasing until acceptance, then leaves exactly two units to purchase', () => {
    let state = rebalanceAppState();
    state.minMax!.skus[0]!.referencePrice = 1000;
    state.minMax!.branchStocks.forEach((r, i) => {
      r.stock = [68, 62, 50][i]!;
      if (i === 2) r.min = 60;
    });
    state.rebalance.config.transferAmountFilter = {
      enabled: true,
      threshold: 5000,
    };
    state.rebalance.proposal = createProposal(state);
    const need = () =>
      derive(state).purchaseDemand.find((r) => r.branch === 'Получатель')!
        .purchaseQty;
    expect(state.rebalance.proposal.transfers.map((t) => t.qty)).toEqual([8]);
    expect(need()).toBe(10);
    state = {
      ...state,
      ...prepareAcceptedChange(state, {
        kind: 'accept',
        ids: state.rebalance.proposal.transfers.map((t) => t.sourceLineId),
        expectedRevision: 0,
      }).patch,
    };
    expect(need()).toBe(2);
    expect(state.rebalance.accepted.map((t) => t.qty)).toEqual([8]);
    state = {
      ...state,
      ...prepareAcceptedChange(state, {
        kind: 'revoke',
        ids: state.rebalance.accepted.map((t) => t.transferId),
        expectedRevision: 1,
      }).patch,
    };
    expect(need()).toBe(10);
  });
  it('never combines opposite directions or accepted documents from distinct runs', () => {
    const s = network([['A', 1000, 6, 0]]);
    const ledger = (['one', 'two'] as const).map(
      (sourceRunId, i): AcceptedTransfer => ({
        transferId: 't' + i,
        sourceLineId: 'l' + i,
        sourceRunId,
        skuCode: 'A',
        fromBranchId: 'D',
        toBranchId: 'R',
        qty: 3,
        snapshotId: s.snapshotId,
        acceptedAt: '2026-11-03T09:01:00Z',
        acceptedConfig: settings(),
      }),
    );
    expect(acceptedEconomicDiagnostics(s, ledger)).toHaveLength(2);
    ledger[1]!.sourceRunId = 'one';
    ledger[1]!.fromBranchId = 'R';
    ledger[1]!.toBranchId = 'D';
    expect(acceptedEconomicDiagnostics(s, ledger)).toHaveLength(2);
  });
  it('preserves physical shortage diagnostics even when the active amount filter has no price', () => {
    const s = network([['A', null, 8, 2]]);
    s.stocks.find((r) => r.branchId === 'D2')!.stock = 100;
    const p = plan(s);
    expect(p.transfers).toEqual([]);
    expect(p.skippedSkus).toEqual([
      expect.objectContaining({
        neededQty: 10,
        deliverableQty: 0,
        missingQty: 10,
        reason: 'AMOUNT_THRESHOLD',
      }),
    ]);
  });
  it('rejects a small accepted line even when another donor covers the recipient total', () => {
    const s = network([['A', 1000, 8, 8]]),
      p = plan(s);
    expect(p.transfers).toHaveLength(2);
    p.transfers.find((t) => t.fromBranchId === 'D2')!.qty = 2;
    expect(() => accept(s, p)).toThrow('INVALID_TRANSFER_BATCH');
  });
});

function stockException(multiplier: 2 | 3, enabled = true): RebalanceConfig {
  return { ...settings(), stockAmountException: { enabled, multiplier } };
}

describe('donor stock exception to the directed SKU minimum', () => {
  it.each([
    [2, 201, false, false],
    [2, 200, true, false],
    [2, 201, true, true],
    [3, 201, true, false],
    [3, 300, true, false],
    [3, 301, true, true],
  ] as const)('with ×%s at stock %s and enabled %s yields exception %s', (multiplier, stock, enabled, exempt) => {
    const s = network([['A', 10, stock - 100, 2]]);
    const p = plan(s, stockException(multiplier, enabled));
    expect(p.transfers.map((t) => [t.fromBranchId, t.qty])).toEqual(
      exempt ? [['D', stock - 100]] : [],
    );
    expect(p.exclusions.filter((i) => i.code === 'TRANSFER_AMOUNT_FILTER').map((i) => i.fromBranchId))
      .toEqual(exempt ? ['D2'] : ['D', 'D2']);
  });

  it('compares fractional stock exactly and handles a zero maximum', () => {
    const s = network([['A', 1, 1, 0]]);
    s.skus[0]!.quantityStep = 0.01;
    const donor = s.stocks[0]!;
    donor.max = 0.07;
    donor.stock = 0.21;
    s.stocks[2]!.min = s.stocks[2]!.max = 0.01;
    expect(plan(s, stockException(3)).transfers).toHaveLength(0);
    donor.stock = 0.22;
    expect(plan(s, stockException(3)).transfers[0]!.qty).toBe(0.01);
    donor.max = 0;
    expect(plan(s, stockException(3)).transfers[0]!.qty).toBe(0.01);
  });

  it('keeps the exemption for partial acceptance of one plan and reserves outgoing stock in a new plan', () => {
    const s = network([['A', 10, 101, 0]]);
    s.branches.push({ id: 'R2', name: 'R2', active: true, aliases: [] });
    const recipient = s.stocks[2]!;
    recipient.min = recipient.max = 30;
    s.stocks.push({ ...recipient, branchId: 'R2', sourceRow: 4 });
    const c = stockException(2);
    const p = plan(s, c);
    expect(p.transfers.map((t) => t.qty)).toEqual([30, 30]);
    const first = accept(s, p, [p.transfers[0]!.sourceLineId]);
    expect(first.diagnostics).toEqual([]);
    expect(plan(s, c, first.nextAccepted).transfers).toEqual([]);
    const all = accept(s, p, [p.transfers[1]!.sourceLineId], first.nextAccepted);
    expect(all.nextAccepted.map((t) => t.qty)).toEqual([30, 30]);
    expect(all.diagnostics).toEqual([]);
    expect(revokeTransfers({
      snapshot: s,
      currentAccepted: all.nextAccepted,
      transferIds: [all.nextAccepted[0]!.transferId],
      currentRevision: 2,
      expectedRevision: 2,
    }).diagnostics).toEqual([]);
  });

  it('permits an unknown price only for a qualifying donor when the amount filter is enabled', () => {
    const s = network([['A', null, 101, 2]]);
    const p = plan(s, stockException(2));
    expect(p.transfers.map((t) => t.fromBranchId)).toEqual(['D']);
    expect(p.exclusions.filter((i) => i.code === 'TRANSFER_AMOUNT_UNKNOWN').map((i) => i.fromBranchId))
      .toEqual(['D2']);
    const accepted = accept(s, p);
    expect(accepted.nextAccepted).toHaveLength(1);
    expect(accepted.diagnostics).toEqual([]);
  });

  it('does not override blocked routes', () => {
    const s = network([['A', 10, 101, 2]]);
    const c = stockException(2);
    c.routeConfig.pairs.push({ branchAId: 'D', branchBId: 'R', direction: 'BLOCKED' });
    const p = plan(s, c);
    expect(p.transfers).toEqual([]);
    expect(p.skippedSkus?.[0]?.reason).toBe('AMOUNT_THRESHOLD');
  });

  it('keeps disabled and legacy fingerprints compatible and invalidates changed enabled conditions', () => {
    expect(rebalanceConfigFingerprint(stockException(3, false)))
      .toBe(rebalanceConfigFingerprint(settings()));
    expect(rebalanceConfigFingerprint(stockException(2)))
      .not.toBe(rebalanceConfigFingerprint(stockException(3)));
    expect(rebalanceConfigFingerprint(stockException(2)))
      .not.toBe(rebalanceConfigFingerprint(settings()));
  });
});
