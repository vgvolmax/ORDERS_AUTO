import { describe, expect, it } from 'vitest';
import { buildPurchaseDemand } from '../../src/domain/purchaseDemand';
import { buildOrderProjection } from '../../src/domain/orders';
import { calculateRebalance } from '../../src/domain/rebalancing/calculate';
import { acceptTransfers, revokeTransfers } from '../../src/domain/rebalancing/acceptedTransfers';
import { rebalanceConfigFingerprint } from '../../src/domain/rebalancing/constraints';
import type { AcceptedTransfer, RebalanceProposal } from '../../src/domain/rebalancing/types';
import type { PricedDemandLine, SupplierResolution } from '../../src/domain/types';
import { config, registry, snapshot } from '../fixtures/rebalanceFixtures';

const settings = { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' as const };
const resolution: SupplierResolution = { skuCode: '00001', selectedSupplier: 'Поставщик', status: 'AUTO_SINGLE', candidates: [], recommendedSupplier: 'Поставщик' };
function demand(overrides: Partial<PricedDemandLine> = {}): PricedDemandLine {
  return { skuCode: '00001', article: 'A', name: 'Товар', branch: 'Получатель', stock: 10, min: 20, max: 60, status: 'BELOW_MIN',
    deficitQty: 50, deficitPct: 50 / 60, networkDeficitQty: 50, referencePrice: 100,
    selectedSupplier: 'Поставщик', supplierResolutionStatus: 'AUTO_SINGLE', unit: 'шт', unitPrice: 100, priceSource: 'SUPPLIER_HISTORY',
    demandAmount: 5000, networkDemandAmount: 5000, networkMissingPriceCount: 0, ...overrides };
}
function lines(donorStock = 110): PricedDemandLine[] {
  return [demand({ branch: 'Донор', stock: donorStock, status: 'OK', deficitQty: 0, deficitPct: 0, demandAmount: 0 }), demand()];
}
function move(qty = 15): AcceptedTransfer {
  return { transferId: 'a1', sourceRunId: 'run1', sourceLineId: 'l1', skuCode: '00001', fromBranchId: 'D', toBranchId: 'R', qty, snapshotId: 'snapshot-1', acceptedAt: '2026-10-20T13:00:00Z', acceptedConfig: config() };
}

describe('effective purchasing from accepted transfers', () => {
  it('changes current need but retains immutable original context and network quantities', () => {
    const data = lines(); const before = structuredClone(data); data.forEach(Object.freeze); Object.freeze(data);
    const result = buildPurchaseDemand(data, [move()], registry());
    expect(result[1]).toMatchObject({ originalNeed: 50, deficitQty: 50, stock: 10, acceptedIncomingQty: 15, projectedStock: 25, purchaseQty: 35, purchaseAmount: 3500, purchaseStatus: 'ORANGE', networkPurchaseQty: 35, networkPurchaseAmount: 3500, acceptedTransferIds: ['a1'] });
    expect(result[0]).toMatchObject({ acceptedOutgoingQty: 15, projectedStock: 95, purchaseQty: 0 });
    expect(data).toEqual(before);
  });
  it('feeds current quantities, manual edits and warnings into the existing order builder', () => {
    const purchase = buildPurchaseDemand(lines(), [move()], registry());
    const calculated = buildOrderProjection(purchase, [resolution], [], settings);
    expect(calculated.orders[0]).toMatchObject({ totalQty: 35, totalAmount: 3500 });
    expect(calculated.orders[0]!.lines[0]).toMatchObject({ calculatedQty: 35, orderQty: 35, purchaseContext: { originalNeed: 50, acceptedIncomingQty: 15 } });
    const edited = buildOrderProjection(purchase, [resolution], [{ skuCode: '00001', branch: 'Получатель', qty: 40 }], settings);
    expect(edited.orders[0]!.lines[0]).toMatchObject({ calculatedQty: 35, orderQty: 40, amount: 4000 });
    expect(edited.orders[0]!.lines[0]!.warnings).toContain('Количество выше расчётного');
  });
  it('fully covered demand disappears from both orders and unresolved supplier problems', () => {
    const purchase = buildPurchaseDemand(lines(), [move(50)], registry());
    expect(buildOrderProjection(purchase, [resolution], [], settings)).toEqual({ orders: [], unassigned: [] });
    expect(buildOrderProjection(purchase, [], [], settings)).toEqual({ orders: [], unassigned: [] });
    const partial = buildOrderProjection(buildPurchaseDemand(lines(), [move()], registry()), [], [], settings);
    expect(partial.unassigned[0]!.demand).toMatchObject({ purchaseQty: 35, purchaseAmount: 3500 });
  });
  it('preserves legacy purchasing and both threshold modes with zero accepted movements', () => {
    const data = lines(), baseline = buildOrderProjection(data, [resolution], [], settings);
    const derived = buildOrderProjection(buildPurchaseDemand(data, [], registry()), [resolution], [], settings);
    const { purchaseContext: _context, ...line } = derived.orders[0]!.lines[0]!;
    expect(line).toEqual(baseline.orders[0]!.lines[0]);
    expect(derived.orders[0]!.status).toBe('READY');
    expect(buildOrderProjection(buildPurchaseDemand(data, [move()], registry()), [resolution], [], { ...settings, minimumOrderAmount: 4000 }).orders[0]!.belowThreshold).toBe(true);
    expect(buildOrderProjection(buildPurchaseDemand(data, [move()], registry()), [resolution], [], { minimumOrderAmount: 4000, thresholdMode: 'BRANCH_SUPPLIER' }).orders[0]!.belowThreshold).toBe(true);
  });
  it('reprices quantities and carries unknown money without inventing a zero', () => {
    const data = lines(); data[1]!.unitPrice = null; data[1]!.priceSource = 'MISSING'; data[1]!.demandAmount = null;
    const result = buildPurchaseDemand(data, [move()], registry());
    expect(result[1]).toMatchObject({ purchaseQty: 35, purchaseAmount: null, networkPurchaseAmount: 0, networkPurchaseMissingPriceCount: 1 });
    expect(buildOrderProjection(result, [resolution], [], settings).orders[0]!.status).toBe('BLOCKED');
    data[1]!.unitPrice = 130;
    expect(buildPurchaseDemand(data, [move()], registry())[1]!.purchaseAmount).toBe(4550);
  });
  it('does not count duplicate moves, unknown identities, invalid quantities or unsafe donor outflow', () => {
    expect(() => buildPurchaseDemand(lines(), [move(), move()], registry())).toThrow();
    expect(() => buildPurchaseDemand(lines(), [{ ...move(), toBranchId: 'missing' }], registry())).toThrow();
    expect(() => buildPurchaseDemand(lines(), [{ ...move(), qty: NaN }], registry())).toThrow();
    expect(() => buildPurchaseDemand(lines(80), [move(21)], registry())).toThrow();
    expect(() => buildPurchaseDemand([...lines(), demand()], [move()], registry())).toThrow();
  });
  it('does not resurrect NO_NORM/INVALID_NORM lines, and supports branch aliases', () => {
    const data = lines(); data[1]!.branch = 'Старое имя'; const branches = registry(); branches[1]!.aliases = ['Старое имя'];
    expect(buildPurchaseDemand(data, [move()], branches)[1]!.purchaseQty).toBe(35);
    const bad = demand({ max: 0, status: 'NO_NORM', deficitQty: 0, demandAmount: 0 });
    expect(buildPurchaseDemand([bad], [], registry())[0]!.purchaseQty).toBe(0);
  });
  it('joins allocation, sequential acceptance, revoke and order quantities end to end in the domain', () => {
    const s = snapshot(); s.stocks[0]!.stock = 75;
    s.branches.push({ id: 'D2', name: 'Второй донор', active: true, aliases: [] });
    s.stocks.push({ skuCode: '00001', branchId: 'D2', stock: 80, min: 20, max: 60, sourceRow: 9 });
    const c = config(); const result = calculateRebalance(s, c, []);
    const proposal: RebalanceProposal = { ...result, runId: 'r', snapshotId: s.snapshotId, createdAt: '2026-10-20T13:00:00Z', baseAcceptedRevision: 0, configFingerprint: rebalanceConfigFingerprint(c), config: c };
    const firstLine = result.transfers.find((t) => t.fromBranchId === 'D')!;
    const secondLine = result.transfers.find((t) => t.fromBranchId === 'D2')!;
    const baseInput = { snapshot: s, currentProposal: proposal, currentConfigFingerprint: proposal.configFingerprint, acceptedAt: '2026-10-20T13:01:00Z', transferIdBySourceLineId: { [firstLine.sourceLineId]: 'first', [secondLine.sourceLineId]: 'second' } };
    const first = acceptTransfers({ ...baseInput, currentAccepted: [], selectedLineIds: [firstLine.sourceLineId], currentRevision: 0, expectedRevision: 0 });
    const current = [...lines(75), demand({ branch: 'Второй донор', stock: 80, status: 'OK', deficitQty: 0, demandAmount: 0 })];
    const amount = (accepted: AcceptedTransfer[]) => buildOrderProjection(buildPurchaseDemand(current, accepted, s.branches), [resolution], [], settings).orders[0]!.totalQty;
    expect(amount(first.nextAccepted)).toBe(35);
    const second = acceptTransfers({ ...baseInput, currentAccepted: first.nextAccepted, selectedLineIds: [secondLine.sourceLineId], currentRevision: 1, expectedRevision: 1 });
    expect(amount(second.nextAccepted)).toBe(15);
    const removed = revokeTransfers({ snapshot: s, currentAccepted: second.nextAccepted, transferIds: ['first'], currentRevision: 2, expectedRevision: 2 });
    expect(amount(removed.nextAccepted)).toBe(30);
  });
});
