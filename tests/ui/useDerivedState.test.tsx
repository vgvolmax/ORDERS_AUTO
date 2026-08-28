import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDerivedState } from '../../src/app/useDerivedState';
import { baseState } from './renderWithStore';

describe('useDerivedState', () => {
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
