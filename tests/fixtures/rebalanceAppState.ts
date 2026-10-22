import { createInitialState } from '../../src/app/initialState';
export function rebalanceAppState() {
  const state = createInitialState({ page: 'rebalancing' });
  const branches = ['Донор А', 'Донор Б', 'Получатель'];
  state.minMax = {
    skus: [
      {
        code: 'SKU1',
        name: 'Товар для перемещения',
        article: 'A1',
        referencePrice: 100,
        reportedTotalStock: null,
      },
    ],
    branches,
    branchStocks: branches.map((branch, i) => ({
      skuCode: 'SKU1',
      branch,
      stock: [75, 80, 10][i]!,
      min: 20,
      max: 60,
    })),
  };
  state.suppliers = {
    suppliers: ['Поставщик'],
    history: [
      {
        skuCode: 'SKU1',
        skuName: 'Товар для перемещения',
        supplier: 'Поставщик',
        unit: 'шт',
        purchaseQty: 1,
        purchaseAmount: 100,
        weightedUnitCost: 100,
      },
    ],
  };
  state.rebalance.registry = branches.map((name, i) => ({
    id: `b${i}`,
    name,
    aliases: [],
    active: true,
  }));
  state.rebalance.policies = [{ skuCode: 'SKU1', unit: 'шт', quantityStep: 1 }];
  return state;
}
