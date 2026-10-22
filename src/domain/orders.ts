import type { PurchaseDemandLine } from './purchaseDemand';
import type {
  Order,
  OrderProjection,
  OrderQtyEdit,
  OrderSettings,
  PricedDemandLine,
  SupplierResolution,
} from './types';

export function buildOrderProjection(
  demand: (PricedDemandLine | PurchaseDemandLine)[],
  resolutions: SupplierResolution[],
  edits: OrderQtyEdit[],
  settings: OrderSettings,
): OrderProjection {
  const resolutionBySku = new Map(
    resolutions.map((resolution) => [resolution.skuCode, resolution]),
  );
  const editBySkuBranch = new Map(
    edits.map((edit) => [`${edit.skuCode}\0${edit.branch}`, edit.qty]),
  );
  const groups = new Map<string, Order>();
  const unassigned: OrderProjection['unassigned'] = [];

  for (const line of demand) {
    const purchase = 'purchaseQty' in line ? line : null;
    const calculatedQty = purchase ? purchase.purchaseQty : line.deficitQty;
    if (
      calculatedQty <= 0 ||
      line.status === 'INVALID_NORM' ||
      line.status === 'NO_NORM'
    ) {
      continue;
    }

    const resolution = resolutionBySku.get(line.skuCode);
    if (!resolution?.selectedSupplier) {
      const fallbackResolution: SupplierResolution = resolution ?? {
        skuCode: line.skuCode,
        selectedSupplier: null,
        status: 'UNRESOLVED',
        candidates: [],
        recommendedSupplier: null,
      };

      unassigned.push({
        demand: line,
        supplierResolution: fallbackResolution,
        blocker:
          fallbackResolution.status === 'MANUAL_REQUIRED'
            ? 'MULTIPLE_SUPPLIERS_REQUIRE_CHOICE'
            : fallbackResolution.status === 'STALE_OVERRIDE'
            ? 'STALE_SUPPLIER_OVERRIDE'
            : 'NO_SUPPLIER',
      });
      continue;
    }

    const id = `${line.branch}\0${resolution.selectedSupplier}`;
    const order = groups.get(id) ?? {
      id,
      branch: line.branch,
      supplier: resolution.selectedSupplier,
      lines: [],
      totalQty: 0,
      totalAmount: 0,
      belowThreshold: false,
      status: 'READY',
      blockers: [],
    };

    const orderQty =
      editBySkuBranch.get(`${line.skuCode}\0${line.branch}`) ?? calculatedQty;
    if (orderQty < 0) {
      throw new Error('Количество не может быть отрицательным');
    }

    order.lines.push({
      ...(purchase
        ? {
            purchaseContext: {
              originalNeed: purchase.originalNeed,
              acceptedIncomingQty: purchase.acceptedIncomingQty,
              acceptedOutgoingQty: purchase.acceptedOutgoingQty,
              projectedStock: purchase.projectedStock,
              purchaseQty: purchase.purchaseQty,
              purchaseAmount: purchase.purchaseAmount,
              purchaseStatus: purchase.purchaseStatus,
              purchaseDeficitPct: purchase.purchaseDeficitPct,
              acceptedTransferIds: [...purchase.acceptedTransferIds],
              networkPurchaseQty: purchase.networkPurchaseQty,
              networkPurchaseAmount: purchase.networkPurchaseAmount,
              networkPurchaseMissingPriceCount:
                purchase.networkPurchaseMissingPriceCount,
            },
          }
        : {}),
      skuCode: line.skuCode,
      article: line.article,
      name: line.name,
      branch: line.branch,
      supplier: resolution.selectedSupplier,
      calculatedQty,
      orderQty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      priceSource: line.priceSource,
      amount: line.unitPrice == null ? null : orderQty * line.unitPrice,
      warnings: orderQty > calculatedQty ? ['Количество выше расчётного'] : [],
      stock: line.stock,
      min: line.min,
      max: line.max,
    });

    groups.set(id, order);
  }

  const orders = [...groups.values()];
  for (const order of orders) {
    const positiveLines = order.lines.filter((line) => line.orderQty > 0);
    order.totalQty = positiveLines.reduce(
      (sum, line) => sum + line.orderQty,
      0,
    );

    if (positiveLines.length === 0) {
      order.totalAmount = 0;
      order.blockers.push('Нет позиций с количеством больше нуля');
      continue;
    }

    const hasMissingPrice = positiveLines.some((line) => line.amount == null);
    order.totalAmount = hasMissingPrice
      ? null
      : positiveLines.reduce((sum, line) => sum + (line.amount ?? 0), 0);

    if (hasMissingPrice) {
      order.blockers.push('Не хватает цены');
    }
  }

  const supplierTotals = new Map<string, number | null>();
  for (const order of orders) {
    const previous = supplierTotals.get(order.supplier);
    if (previous === null || order.totalAmount == null) {
      supplierTotals.set(order.supplier, null);
    } else {
      supplierTotals.set(order.supplier, (previous ?? 0) + order.totalAmount);
    }
  }

  for (const order of orders) {
    const comparedAmount =
      settings.thresholdMode === 'SUPPLIER_TOTAL'
        ? supplierTotals.get(order.supplier)
        : order.totalAmount;

    order.belowThreshold =
      comparedAmount != null && comparedAmount < settings.minimumOrderAmount;

    if (order.belowThreshold) {
      order.blockers.push('Ниже минимальной суммы');
    }

    order.status = order.blockers.length > 0 ? 'BLOCKED' : 'READY';
  }

  return { orders, unassigned };
}
