import { useMemo } from 'react';
import type { AppState } from './appStore';
import { derive, type DerivedState } from './selectors';

/**
 * Recomputes the expensive purchasing projection only when business inputs change.
 * Local view state such as search/filter text must not trigger a full 30k-row
 * demand/supplier/order recalculation.
 */
export function useDerivedState(state: AppState): DerivedState {
  return useMemo(
    () => derive(state),
    [
      state.minMax,
      state.suppliers,
      state.overrides,
      state.edits,
      state.settings,
      state.exportedOrderIds,
    ],
  );
}
