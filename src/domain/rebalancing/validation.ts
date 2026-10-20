import { stockKey, type RebalanceIssue, type RebalanceSnapshot } from './types';

const duplicates = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
};
const finiteNonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function validateRebalanceSnapshot(snapshot: RebalanceSnapshot): RebalanceIssue[] {
  const issues: RebalanceIssue[] = [];
  const emit = (code: string, message: string, context: Partial<RebalanceIssue> = {}) => {
    issues.push({ code, message, severity: 'ERROR', sourceRow: null, ...context });
  };
  if (snapshot.schemaVersion !== 1 || !snapshot.snapshotId.trim()) emit('INVALID_SNAPSHOT', 'Нет идентификатора или не поддерживается версия снимка');
  const branchIds = duplicates(snapshot.branches.map((b) => b.id));
  const skuIds = duplicates(snapshot.skus.map((s) => s.skuCode));
  for (const b of snapshot.branches) {
    if (!b.id.trim() || !b.name.trim()) emit('INVALID_BRANCH', 'Нет идентификатора или названия подразделения', { branchId: b.id });
    if (branchIds.has(b.id)) emit('DUPLICATE_BRANCH_ID', 'Повторяющийся ID подразделения', { branchId: b.id });
  }
  for (const sku of snapshot.skus) {
    const context = { skuCode: sku.skuCode };
    if (!sku.skuCode.trim()) emit('INVALID_SKU', 'Нет кода 1С', context);
    if (skuIds.has(sku.skuCode)) emit('DUPLICATE_SKU_ID', 'Повторяющийся код 1С', context);
    if (!sku.unit?.trim() || !finiteNonnegative(sku.quantityStep) || sku.quantityStep === 0)
      emit('INVALID_QUANTITY_POLICY', 'Не заданы согласованная единица и положительный шаг количества', context);
    if (sku.referencePrice !== null && !finiteNonnegative(sku.referencePrice))
      emit('INVALID_PRICE', 'Некорректная учётная цена; денежная оценка неизвестна', { ...context, severity: 'WARNING' });
  }
  const branches = new Map(snapshot.branches.map((b) => [b.id, b]));
  const skus = new Set(snapshot.skus.map((s) => s.skuCode));
  const stockDuplicates = duplicates(snapshot.stocks.map((s) => stockKey(s.skuCode, s.branchId)));
  snapshot.stocks.forEach((line, stockIndex) => {
    const context = { skuCode: line.skuCode, branchId: line.branchId, sourceRow: line.sourceRow, stockIndex };
    if (stockDuplicates.has(stockKey(line.skuCode, line.branchId))) emit('DUPLICATE_SKU_BRANCH', 'Повторяющийся срез товара и подразделения', context);
    if (!branches.has(line.branchId)) emit('UNKNOWN_BRANCH', 'Подразделение отсутствует в реестре', context);
    else if (!branches.get(line.branchId)!.active) emit('INACTIVE_BRANCH', 'Подразделение неактивно', context);
    if (!skus.has(line.skuCode)) emit('UNKNOWN_SKU', 'Товар отсутствует в снимке', context);
    if (!finiteNonnegative(line.stock)) emit('INVALID_STOCK', 'Остаток должен быть конечным неотрицательным числом', context);
    if (line.min === null || line.max === null) emit('MISSING_NORM', 'Нет готового Min или Max', context);
    else if (!finiteNonnegative(line.min) || !finiteNonnegative(line.max) || line.min > line.max)
      emit('INVALID_NORM', 'Нормативы должны удовлетворять 0 ≤ Min ≤ Max', context);
  });
  return issues;
}
