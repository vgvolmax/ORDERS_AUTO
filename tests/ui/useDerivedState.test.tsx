import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDerivedState } from '../../src/app/useDerivedState';
import { baseState } from './renderWithStore';

describe('useDerivedState', () => {
  it('uses only accepted quantities for current orders while preserving original demand', () => {
    const state = baseState();
    state.minMax!.branchStocks[1]!.stock = 20;
    state.rebalance.registry = state.minMax!.branches.map((name) => ({
      id: name,
      name,
      active: true,
      aliases: [],
    }));
    state.rebalance.policies = [
      { skuCode: 'SKU1', unit: 'шт', quantityStep: 1 },
    ];
    state.rebalance.accepted = [
      {
        transferId: 't1',
        sourceRunId: 'r1',
        sourceLineId: 'l1',
        snapshotId: state.snapshotId,
        skuCode: 'SKU1',
        fromBranchId: 'Ступино',
        toBranchId: 'Ленина',
        qty: 3,
        acceptedAt: '2026-10-21T00:00:00Z',
        acceptedConfig: state.rebalance.config,
      },
    ];
    const { result } = renderHook(() => useDerivedState(state));
    expect(
      result.current.originalDemand.find((r) => r.branch === 'Ленина')!
        .deficitQty,
    ).toBe(7);
    expect(
      result.current.purchaseDemand.find((r) => r.branch === 'Ленина')!
        .purchaseQty,
    ).toBe(4);
    expect(result.current.projection.orders[0]!.lines[0]!.orderQty).toBe(4);
  });
  it('updates reviewed metadata but ignores presentation-only selection and search changes', () => {
    const state = baseState();
    const { result, rerender } = renderHook(
      ({ currentState }) => useDerivedState(currentState),
      { initialProps: { currentState: state } },
    );
    const initial = result.current;
    rerender({
      currentState: {
        ...state,
        toast: 'saved',
        uiPreferences: { query: 'x' },
        rebalance: { ...state.rebalance, selectedLineIds: ['x'] },
      },
    });
    expect(result.current).toBe(initial);
    const orderId = initial.projection.orders[0]!.id;
    rerender({ currentState: { ...state, reviewedOrderIds: [orderId] } });
    expect(
      result.current.projection.orders.find((r) => r.id === orderId)!.reviewed,
    ).toBe(true);
  });
  it('reuses the projection when business inputs have not changed', () => {
    const state = baseState();
    const { result, rerender } = renderHook(
      ({ currentState }) => useDerivedState(currentState),
      { initialProps: { currentState: state } },
    );
    const first = result.current;

    rerender({ currentState: state });

    expect(result.current).toBe(first);
  });

  it('recalculates when an order edit changes', () => {
    const state = baseState();
    const { result, rerender } = renderHook(
      ({ currentState }) => useDerivedState(currentState),
      { initialProps: { currentState: state } },
    );
    const first = result.current;

    rerender({
      currentState: {
        ...state,
        edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }],
      },
    });

    expect(result.current).not.toBe(first);
  });
});

it('refreshes inferred units when source diagnostics change without replacing the parsed dataset', () => {
  const state = baseState();
  const { result, rerender } = renderHook(
    ({ currentState }) => useDerivedState(currentState),
    { initialProps: { currentState: state } },
  );
  expect(result.current.quantityPolicies[0]!.unit).toBe('шт');
  rerender({
    currentState: {
      ...state,
      supplierIssues: [
        {
          code: 'MIXED_UNITS',
          severity: 'WARNING',
          skuCode: 'SKU1',
          message: 'Разные единицы',
        },
      ],
    },
  });
  expect(result.current.quantityPolicies[0]!.unit).toBe('ед.');
});
