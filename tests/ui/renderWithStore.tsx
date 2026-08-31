import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { StoreContext, type AppState } from '../../src/app/appStore';

export function renderWithStore(
  ui: ReactElement,
  state: AppState,
  set: (patch: Partial<AppState>) => void = () => undefined,
) {
  return render(
    <StoreContext.Provider value={{ state, set }}>{ui}</StoreContext.Provider>,
  );
}

export function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    minMax: {
      skus: [
        {
          code: 'SKU1',
          article: 'A-1',
          name: 'Товар 1',
          referencePrice: 100,
          reportedTotalStock: 5,
        },
      ],
      branchStocks: [
        { skuCode: 'SKU1', branch: 'Ленина', stock: 3, min: 5, max: 10 },
        { skuCode: 'SKU1', branch: 'Ступино', stock: 6, min: 5, max: 10 },
      ],
      branches: ['Ленина', 'Ступино'],
    },
    suppliers: {
      suppliers: ['Поставщик А'],
      history: [
        {
          supplier: 'Поставщик А',
          skuCode: 'SKU1',
          skuName: 'Товар 1',
          unit: 'шт',
          purchaseQty: 10,
          purchaseAmount: 1000,
          weightedUnitCost: 100,
        },
      ],
    },
    minMaxFileName: null,
    supplierFileName: null,
    minMaxIssues: [],
    supplierIssues: [],
    overrides: [],
    edits: [],
    settings: { minimumOrderAmount: 0, thresholdMode: 'SUPPLIER_TOTAL' },
    reviewedOrderIds: [],
    exportedOrderIds: [],
    page: 'all',
    toast: null,
    minMaxLoading: false,
    supplierLoading: false,
    ...overrides,
  };
}
