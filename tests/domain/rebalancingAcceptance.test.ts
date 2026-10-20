import { describe, expect, it } from 'vitest';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import { acceptTransfers } from '../../src/domain/rebalancing/acceptedTransfers';
import { rebalanceConfigFingerprint } from '../../src/domain/rebalancing/constraints';
import type { AcceptedTransfer, RebalanceProposal } from '../../src/domain/rebalancing/types';
import { config, snapshot } from '../fixtures/rebalanceFixtures';

const qty = (s = snapshot(), c = config()) => calculateRebalance(s, c, []).transfers.reduce((v, t) => v + t.qty, 0);

describe('rebalancing business acceptance', () => {
  it('gives only stock minus Max and does not mutate inputs', () => {
    const s = snapshot(), c = config(); const before = structuredClone({ s, c });
    const result = calculateRebalance(s, c, []);
    expect(result.transfers).toHaveLength(1); expect(result.transfers[0]!.qty).toBe(20);
    expect(result.balances.map((b) => b.stockAfter)).toEqual([60, 30]); expect({ s, c }).toEqual(before);
  });
  it('receiver zero percent fills to Min, while an eligible receiver never exceeds its target', () => {
    expect(qty(snapshot(), config({ receiverPct: 0 }))).toBe(10);
    const s = snapshot(); s.stocks[0]!.stock = 200;
    expect(qty(s)).toBe(50); expect(qty(s, config({ receiverPct: 50 }))).toBe(30);
  });
  it('uses a configured recipient trigger, with strict equality boundaries', () => {
    const s = snapshot(); s.stocks[0]!.stock = 200; s.stocks[1]!.stock = 30;
    expect(qty(s)).toBe(0); expect(qty(s, config({ recipientTrigger: 'BELOW_MAX' }))).toBe(30);
    s.stocks[1]!.stock = 20; expect(qty(s)).toBe(0);
    s.stocks[1]!.stock = 60; expect(qty(s, config({ recipientTrigger: 'BELOW_MAX' }))).toBe(0);
    s.stocks[1]!.stock = 30; expect(qty(s, config({ recipientTrigger: 'BELOW_MAX', receiverPct: 0 }))).toBe(0);
  });
  it('rounds capacities safely and keeps decimal quantities exactly on step', () => {
    const s = snapshot(); s.skus[0]!.quantityStep = 0.25; s.stocks[0]!.stock = 80.15;
    expect(qty(s)).toBe(20); expect(calculateRebalance(s, config(), []).balances[0]!.stockAfter).toBe(60.15);
    s.skus[0]!.quantityStep = 0.1; s.stocks[0]!.stock = 60.3;
    expect(qty(s)).toBe(0.3);
  });
  it('rounds transferable deltas instead of absolute stock targets, including acceptance', () => {
    const s = snapshot(), c = config();
    Object.assign(s.stocks[1]!, { stock: 0.5, min: 1, max: 2.5 });
    const result = calculateRebalance(s, c, []);
    expect(result.transfers[0]!.qty).toBe(2);
    expect(result.balances.find((b) => b.branchId === 'R')!.stockAfter).toBe(2.5);
    const proposal: RebalanceProposal = { ...result, runId: 'fraction', snapshotId: s.snapshotId, createdAt: '2026-10-20T13:00:00Z', baseAcceptedRevision: 0, configFingerprint: rebalanceConfigFingerprint(c), config: c };
    const accepted = acceptTransfers({ snapshot: s, currentAccepted: [], currentProposal: proposal, selectedLineIds: result.transfers.map((t) => t.sourceLineId), currentRevision: 0, expectedRevision: 0, currentConfigFingerprint: proposal.configFingerprint, acceptedAt: '2026-10-20T13:01:00Z', transferIdBySourceLineId: { [result.transfers[0]!.sourceLineId]: 'fraction' } });
    expect(accepted.nextAccepted[0]!.qty).toBe(2);
    expect(calculateRebalance(s, c, accepted.nextAccepted).transfers).toEqual([]);
    expect(qty(s, config({ receiverPct: 50 }))).toBe(1); // target1.75, stock after1.5.
    expect(qty(s, config({ receiverPct: 0 }))).toBe(0); // next whole unit would exceed Min1.
  });
  it('covers a fractional Min shortage before filling another receiver above Min', () => {
    const s = snapshot(); s.stocks[0]!.stock = 61;
    Object.assign(s.stocks[1]!, { stock: 0.5, min: 1, max: 2 });
    s.branches.push({ id: 'R2', name: 'R2', active: true, aliases: [] });
    s.stocks.push({ skuCode: '00001', branchId: 'R2', stock: 0, min: 0, max: 10, sourceRow: 5 });
    const result = calculateRebalance(s, config({ recipientTrigger: 'BELOW_MAX' }), []);
    expect(result.transfers).toEqual([expect.objectContaining({ toBranchId: 'R', qty: 1 })]);
    expect(result.balances.find((b) => b.branchId === 'R')!.stockAfter).toBe(1.5);
    expect(result.uncoveredNeed.find((b) => b.branchId === 'R')!.toMin).toBe(0);
  });
  it('accepts missing price when filters are off and keeps money unknown', () => {
    const s = snapshot(); s.skus[0]!.referencePrice = null;
    expect(qty(s)).toBe(20);
    expect(qty(s, config({ unitPriceFilter: { enabled: true, threshold: 0 } }))).toBe(0);
  });
  it('checks economic total for the SKU across every route and recomputes excluded balances', () => {
    const s = snapshot(); s.stocks[0]!.stock = 71;
    s.branches.push({ id: 'R2', name: 'R2', active: true, aliases: [] });
    s.stocks[1]!.min = s.stocks[1]!.max = 16;
    s.stocks.push({ skuCode: '00001', branchId: 'R2', stock: 0, min: 5, max: 5, sourceRow: 5 });
    const c = config({ unitPriceFilter: { enabled: true, threshold: 1000 }, skuAmountFilter: { enabled: true, threshold: 10000 } });
    const good = calculateRebalance(s, c, []);
    expect(good.transfers.map((t) => t.qty).sort((a, b) => a - b)).toEqual([5, 6]);
    s.stocks[0]!.stock = 66;
    const small = calculateRebalance(s, c, []);
    expect(small.transfers).toEqual([]); expect(small.balances.find((b) => b.branchId === 'D')!.stockAfter).toBe(66);
    expect(small.exclusions).toContainEqual(expect.objectContaining({ code: 'SKU_AMOUNT_FILTER', amount: 7200 }));
    expect(qty(snapshot(), config({ unitPriceFilter: { enabled: true, threshold: 1200 } }))).toBe(0);
    expect(qty(snapshot(), config({ skuAmountFilter: { enabled: true, threshold: 24000 } }))).toBe(0);
  });
  it('keeps unmet needs visible when a pre-allocation price filter excludes the SKU', () => {
    const result = calculateRebalance(snapshot(), config({ unitPriceFilter: { enabled: true, threshold: 1200 } }), []);
    expect(result.transfers).toEqual([]);
    expect(result.uncoveredNeed).toContainEqual({ skuCode: '00001', branchId: 'R', toMin: 10, toTarget: 50 });
  });
  it('respects previously accepted donor budgets without turning future incoming into surplus', () => {
    const s = snapshot();
    const accepted: AcceptedTransfer[] = [{ transferId: 'a1', sourceRunId: 'old', sourceLineId: 'line', skuCode: '00001', fromBranchId: 'D', toBranchId: 'R', qty: 15, snapshotId: s.snapshotId, acceptedAt: '2026-10-20T13:00:00Z', acceptedConfig: config() }];
    expect(calculateRebalance(s, config(), accepted).transfers).toEqual([]); // projected R=25: no longer below Min in a NEW run.
    expect(calculateRebalance(s, config({ recipientTrigger: 'BELOW_MAX' }), accepted).transfers[0]!.qty).toBe(5);
    expect(accepted).toHaveLength(1);
  });
  it('emits exclusions for invalid rows, without dropping the valid part of a snapshot', () => {
    const s = snapshot(); s.stocks.push({ skuCode: '00001', branchId: 'missing', stock: 0, min: null, max: 50, sourceRow: 99 });
    const out = calculateRebalance(s, config(), []);
    expect(out.transfers[0]!.qty).toBe(20);
    expect(out.exclusions).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_BRANCH', sourceRow: 99 }));
  });
  it('is deterministic under row, SKU, branch and route ordering and excludes unsafe integer capacity', () => {
    const s = snapshot(), c = config(); const before = calculateRebalance(s, c, []);
    s.stocks.reverse(); s.branches.reverse(); s.skus.reverse();
    expect(calculateRebalance(s, c, [])).toEqual(before);
    s.stocks.find((l) => l.branchId === 'D')!.stock = 1e20;
    const unsafe = calculateRebalance(s, c, []);
    expect(unsafe.transfers).toEqual([]); expect(unsafe.exclusions.map((i) => i.code)).toContain('UNSAFE_QUANTITY_CAPACITY');
  });
  it('does not override a closed direction or invent stock when shortage remains', () => {
    const s = snapshot(); const c = config({ routeConfig: { mode: 'ALL_ALLOWED', pairs: [{ branchAId: 'R', branchBId: 'D', direction: 'A_TO_B' }] } });
    expect(qty(s, c)).toBe(0);
    expect(calculateRebalance(s, config(), []).uncoveredNeed).toContainEqual({ skuCode: '00001', branchId: 'R', toMin: 0, toTarget: 30 });
  });
});
