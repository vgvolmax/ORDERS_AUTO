import { describe, expect, it } from 'vitest';
import { buildAcceptedTransferStatePatch } from '../../src/domain/rebalanceWorkflow';
import { derive } from '../../src/app/selectors';
import { baseState } from '../ui/renderWithStore';
import { rebalanceConfigFingerprint } from '../../src/domain/rebalancing/constraints';
import type { AppState } from '../../src/app/appStore';
function state(): AppState {
  const s = baseState();
  s.minMax!.branches.push('Донор');
  s.minMax!.branchStocks.push({
    skuCode: 'SKU1',
    branch: 'Донор',
    stock: 20,
    min: 5,
    max: 10,
  });
  s.rebalance.registry = s.minMax!.branches.map((name) => ({
    id: name,
    name,
    aliases: [],
    active: true,
  }));
  s.rebalance.policies = [{ skuCode: 'SKU1', unit: 'шт', quantityStep: 1 }];
  s.edits = [
    { skuCode: 'SKU1', branch: 'Ленина', qty: 8 },
    { skuCode: 'SKU1', branch: 'Ступино', qty: 2 },
  ];
  s.settings.minimumOrderAmount = 1000;
  s.reviewedOrderIds = s.exportedOrderIds = [
    'Ленина\0ИП Баранов Роман Борисович',
    'Ступино\0ИП Баранов Роман Борисович',
    'unrelated',
  ];
  return s;
}
function changed(s: AppState, qty: number): AppState {
  return {
    ...s,
    rebalance: {
      ...s.rebalance,
      accepted: [
        {
          transferId: 't1',
          sourceRunId: 'run1',
          sourceLineId: 'line1',
          snapshotId: s.snapshotId,
          skuCode: 'SKU1',
          fromBranchId: 'Донор',
          toBranchId: 'Ленина',
          qty,
          acceptedAt: '2026-10-21T00:00:00Z',
          acceptedConfig: s.rebalance.config,
        },
      ],
    },
  };
}
function patch(previous: AppState, next: AppState) {
  const before = derive(previous),
    after = derive(next);
  return buildAcceptedTransferStatePatch({
    previousDemand: before.purchaseDemand,
    nextDemand: after.purchaseDemand,
    previousProjection: before.projection,
    resolutions: after.resolutions,
    settings: next.settings,
    edits: previous.edits,
    reviewedOrderIds: previous.reviewedOrderIds,
    exportedOrderIds: previous.exportedOrderIds,
  });
}
describe('accepted transfer purchasing invalidation', () => {
  it('clears only changed purchase edits and invalidates adjacent supplier orders after threshold ripple', () => {
    const before = state(),
      after = changed(before, 3),
      result = patch(before, after);
    expect(result.edits).toEqual([
      { skuCode: 'SKU1', branch: 'Ступино', qty: 2 },
    ]);
    expect(result.clearedEditCount).toBe(1);
    expect(result.affectedOrderIds).toEqual([
      'Ленина\0ИП Баранов Роман Борисович',
      'Ступино\0ИП Баранов Роман Борисович',
    ]);
    expect(result.reviewedOrderIds).toEqual(['unrelated']);
    expect(result.exportedOrderIds).toEqual(['unrelated']);
    expect(before.edits).toHaveLength(2);
  });
  it('invalidates disappeared and returning orders and leaves identical acceptance as a no-op', () => {
    const before = state(),
      covered = changed(before, 7),
      result = patch(before, covered);
    expect(result.affectedOrderIds).toContain(
      'Ленина\0ИП Баранов Роман Борисович',
    );
    const committed = { ...covered, ...result };
    const returning = patch(committed, {
      ...committed,
      rebalance: { ...committed.rebalance, accepted: [] },
    });
    expect(returning.affectedOrderIds).toContain(
      'Ленина\0ИП Баранов Роман Борисович',
    );
    expect(patch(before, before)).toMatchObject({
      edits: before.edits,
      reviewedOrderIds: before.reviewedOrderIds,
      exportedOrderIds: before.exportedOrderIds,
      affectedOrderIds: [],
      clearedEditCount: 0,
    });
  });
  it('keeps an explicit exclusion through full transfer coverage and later revocation', () => {
    const before = state();
    const excluded = { skuCode: 'SKU1', branch: 'Ленина', qty: 0, excluded: true } as const;
    before.edits = [excluded, before.edits[1]!];
    const covered = changed(before, 7);
    const coveredPatch = patch(before, covered);
    expect(coveredPatch.edits).toContainEqual(excluded);
    expect(coveredPatch.clearedEditCount).toBe(0);

    const committed = { ...covered, ...coveredPatch };
    const revoked = { ...committed, rebalance: { ...committed.rebalance, accepted: [] } };
    const revokedPatch = patch(committed, revoked);
    const restoredProjection = derive({ ...revoked, ...revokedPatch });
    expect(restoredProjection.purchaseDemand.find((line) => line.branch === 'Ленина')?.purchaseQty).toBe(7);
    expect(restoredProjection.projection.orders.find((order) => order.branch === 'Ленина')?.lines[0])
      .toMatchObject({ calculatedQty: 7, orderQty: 0, excluded: true });
  });
  it('invalidates marker signatures on price-only changes without clearing physical movements', () => {
    const before = changed(state(), 3),
      after = {
        ...before,
        minMax: {
          ...before.minMax!,
          skus: before.minMax!.skus.map((sku) => ({
            ...sku,
            referencePrice: 120,
          })),
        },
      };
    const result = patch(before, after);
    expect(result.clearedEditCount).toBe(0);
    expect(result.affectedOrderIds).toContain(
      'Ленина\0ИП Баранов Роман Борисович',
    );
    expect(after.rebalance.accepted).toBe(before.rebalance.accepted);
  });
});
