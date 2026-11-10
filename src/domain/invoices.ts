import { addDecimal, decimal, multiplyDecimal } from './decimal';
import { moneyProduct, moneySum } from './money';
import { normalizeKey, normalizeText } from './normalize';
import type { Order, OrderLine } from './types';

export interface InvoiceItem {
  skuCode: string | null;
  article: string;
  name: string;
  quantity: number;
  unit: string | null;
  price: number | null;
  amount: number | null;
  sourceRow: number;
}

export type InvoiceDifference = 'missing' | 'extra' | 'quantity' | 'higher' | 'lower' | 'ambiguous' | 'unit' | 'unpriced' | 'amount' | 'signed';

export const invoiceDifferenceLabels: Record<InvoiceDifference, string> = {
  missing: 'Нет в счёте',
  extra: 'Лишнее в счёте',
  quantity: 'Количество',
  higher: 'Дороже',
  lower: 'Дешевле',
  ambiguous: 'Неоднозначно',
  unit: 'Единицы',
  unpriced: 'Нет цены',
  amount: 'Ошибка суммы',
  signed: 'Отрицательные значения',
};

export interface InvoiceComparisonRow {
  id: string;
  skuCode: string | null;
  article: string;
  name: string;
  unit: string | null;
  orderQty: number | null;
  invoiceQty: number | null;
  orderPrice: number | null;
  invoicePrice: number | null;
  invoiceAmount: number | null;
  differences: InvoiceDifference[];
  notes: string[];
}

export interface InvoiceAdjustment {
  id: string;
  skuCode: string | null;
  article: string;
  name: string;
  unit: string | null;
  qty: number | null;
  price: number | null;
  amount: number | null;
  included: boolean;
}

interface OrderGroup {
  id: string;
  skuCode: string;
  unit: string | null;
  lines: OrderLine[];
  matches: InvoiceItem[];
  ambiguousRows: number[];
}

interface InvoiceValues {
  invoiceQty: number;
  invoicePrice: number | null;
  invoiceAmount: number | null;
}

const QTY_EPSILON = 0.0001;
const PRICE_EPSILON = 0.01;
const MANUAL_DIFFERENCES = new Set<InvoiceDifference>(['missing', 'extra', 'ambiguous', 'unit', 'amount', 'signed']);

function articleKey(article: string | null): string {
  return (article ?? '').toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е').replace(/[^0-9A-ZА-Я]/g, '');
}

function articleTokens(article: string | null): string[] {
  const value = (article ?? '').toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е');
  return [...new Set((value.match(/[0-9A-ZА-Я]{3,}/g) ?? [])
    .filter((token) => /[0-9]/.test(token)))];
}

function unitKey(unit: string | null): string {
  return normalizeKey(unit).replace(/[.\s]/g, '');
}

function indexGroup(index: Map<string, Set<OrderGroup>>, key: string, group: OrderGroup): void {
  if (!key) return;
  const groups = index.get(key) ?? new Set<OrderGroup>();
  groups.add(group);
  index.set(key, groups);
}

function groupOrders(orders: readonly Order[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const order of orders) {
    for (const line of order.lines) {
      if (!(line.orderQty > 0)) continue;
      const id = 'order:' + JSON.stringify([line.skuCode, unitKey(line.unit)]);
      let group = groups.get(id);
      if (!group) {
        group = { id, skuCode: line.skuCode, unit: line.unit, lines: [], matches: [], ambiguousRows: [] };
        groups.set(id, group);
      }
      group.lines.push(line);
    }
  }
  return [...groups.values()];
}

function findArticleGroups(
  article: string,
  byArticle: Map<string, Set<OrderGroup>>,
  byToken: Map<string, Set<OrderGroup>>,
): OrderGroup[] {
  const key = articleKey(article);
  const exact = byArticle.get(key);
  if (exact) return [...exact];

  // One full article must occur on the other side. Two longer articles
  // sharing an interior fragment can identify different variants.
  const groups = new Set(byToken.get(key));
  for (const token of articleTokens(article)) {
    for (const group of byArticle.get(token) ?? []) groups.add(group);
  }
  return [...groups];
}

function combinePrices(
  lines: readonly { qty: number; price: number | null }[],
  totalQty: number,
): number | null {
  const products: number[] = [];
  for (const { qty, price } of lines) {
    if (price === null) return null;
    products.push(moneyProduct(qty, price));
  }
  const firstPrice = lines[0]?.price ?? null;
  if (lines.every(({ price }) => price === firstPrice)) return firstPrice;
  return totalQty === 0 ? null : moneySum(products) / totalQty;
}

function invoiceValues(items: readonly InvoiceItem[]): InvoiceValues {
  const invoiceQty = moneySum(items.map((item) => item.quantity));
  const prices = items.map(({ quantity, price, amount }) => ({
    qty: quantity,
    price: price ?? (amount === null || quantity === 0 ? null : amount / quantity),
  }));
  const amounts = items.map(({ quantity, price, amount }) =>
    amount ?? (price === null ? null : moneyProduct(quantity, price)));
  return {
    invoiceQty,
    invoicePrice: combinePrices(prices, invoiceQty),
    invoiceAmount: amounts.some((amount) => amount === null) ? null : moneySum(amounts as number[]),
  };
}

function sourceRows(items: readonly InvoiceItem[]): string {
  return items.map((item) => item.sourceRow).join(', ');
}

function inconsistentAmount({ quantity, price, amount }: InvoiceItem): boolean {
  if (amount === null) return false;
  if (quantity === 0) return amount !== 0;
  if (price === null) return false;

  const delta = addDecimal(decimal(amount), multiplyDecimal(decimal(-quantity), decimal(price)));
  // Supplier totals can differ from the unrounded product by a kopeck.
  return delta.n * 100n < -delta.d || delta.n * 100n > delta.d;
}

function invoiceDiagnostics(items: readonly InvoiceItem[]) {
  const notes: string[] = [];
  const differences: InvoiceDifference[] = [];
  if (items.length > 1) {
    notes.push('Строки счёта ' + sourceRows(items) + ': количество суммировано.');
    const prices = items.flatMap(({ price, amount, quantity }) =>
      price !== null ? [price] : amount !== null && quantity !== 0 ? [amount / quantity] : []);
    if (prices.length === items.length && new Set(prices).size > 1) {
      notes.push('В счёте разные цены, показана средневзвешенная цена.');
    }
  }
  const inconsistent = items.filter(inconsistentAmount);
  if (inconsistent.length) {
    differences.push('amount');
    notes.push(`Сумма не соответствует количеству и цене в строках счёта ${sourceRows(inconsistent)}.`);
  }
  const negativeQty = items.filter(({ quantity }) => quantity < 0);
  const negativePrice = items.filter(({ price }) => price !== null && price < 0);
  const negativeAmount = items.filter(({ amount }) => amount !== null && amount < 0);
  if (negativeQty.length || negativePrice.length || negativeAmount.length) differences.push('signed');
  if (negativeQty.length) notes.push(`Проверьте отрицательное количество в строках счёта ${sourceRows(negativeQty)}.`);
  if (negativePrice.length) notes.push(`Проверьте отрицательную цену в строках счёта ${sourceRows(negativePrice)}.`);
  if (negativeAmount.length) notes.push(`Проверьте отрицательную сумму в строках счёта ${sourceRows(negativeAmount)}.`);
  return { differences, notes };
}

function compareGroup(
  group: OrderGroup,
  items: readonly InvoiceItem[],
  incompatibleItems: boolean,
): InvoiceComparisonRow {
  const { lines } = group;
  const sample = lines[0]!;
  const orderQty = moneySum(lines.map((line) => line.orderQty));
  const prices = lines.map((line) => ({ qty: line.orderQty, price: line.unitPrice }));
  const orderPrice = combinePrices(prices, orderQty);
  const firstItem = items[0];
  const values = firstItem ? invoiceValues(items) : null;
  const { differences, notes } = invoiceDiagnostics(items);
  if (!values && !incompatibleItems && group.ambiguousRows.length === 0) {
    differences.push('missing');
    notes.push('Позиция заказа не найдена в счёте.');
  }
  if (values) {
    const qtyDiff = moneySum([values.invoiceQty, -orderQty]);
    if (Math.abs(qtyDiff) > QTY_EPSILON) {
      differences.push('quantity');
      notes.push(qtyDiff > 0 ? 'В счёте количество больше, чем в заказе.' : 'В счёте количество меньше, чем в заказе.');
    }
    if (orderPrice !== null && values.invoicePrice !== null) {
      const priceDiff = moneySum([values.invoicePrice, -orderPrice]);
      if (Math.abs(priceDiff) > PRICE_EPSILON) {
        differences.push(priceDiff > 0 ? 'higher' : 'lower');
        notes.push(priceDiff > 0 ? 'Цена в счёте выше цены заказа.' : 'Цена в счёте ниже цены заказа.');
      }
    }
  }
  if (!values && incompatibleItems) {
    differences.push('unit');
    notes.push('Позиция в счёте использует несовместимую единицу измерения.');
  }
  if (group.ambiguousRows.length > 0) {
    differences.push('ambiguous');
    notes.push('Возможное совпадение со строками счёта: ' + group.ambiguousRows.join(', ') + '.');
  }
  if (values && (orderPrice === null || values.invoicePrice === null)) {
    differences.push('unpriced');
    if (orderPrice === null) notes.push('В заказе отсутствует цена для полного количества.');
    if (values.invoicePrice === null) notes.push('В счёте отсутствует цена для полного количества.');
  }
  if (orderPrice !== null && new Set(prices.map(({ price }) => price)).size > 1) {
    notes.push('В заказе разные цены, показана средневзвешенная цена.');
  }

  return {
    id: group.id,
    skuCode: group.skuCode,
    article: lines.find((line) => line.article)?.article ?? firstItem?.article ?? '',
    name: sample.name || firstItem?.name || '',
    unit: group.unit || firstItem?.unit || null,
    orderQty,
    invoiceQty: values?.invoiceQty ?? null,
    orderPrice,
    invoicePrice: values?.invoicePrice ?? null,
    invoiceAmount: values?.invoiceAmount ?? null,
    differences,
    notes,
  };
}

function invoiceOnlyRow(
  items: readonly InvoiceItem[],
  difference: 'extra' | 'ambiguous' | 'unit',
  skuCode?: string,
  comment?: string,
): InvoiceComparisonRow {
  const sample = items[0]!;
  const values = invoiceValues(items);
  const { differences, notes } = invoiceDiagnostics(items);
  differences.unshift(difference);
  notes.push(comment ?? 'Позиция счёта не найдена в заказе.');
  if (values.invoicePrice === null) {
    differences.push('unpriced');
    notes.push('В счёте отсутствует цена для полного количества.');
  }
  return {
    id: 'invoice:' + sourceRows(items),
    skuCode: skuCode ?? sample.skuCode,
    article: items.find((item) => item.article)?.article ?? '',
    name: items.find((item) => item.name)?.name ?? '',
    unit: sample.unit,
    orderQty: null,
    orderPrice: null,
    ...values,
    differences,
    notes,
  };
}

function groupByInvoiceUnit(items: readonly InvoiceItem[]): Map<string, InvoiceItem[]> {
  const byUnit = new Map<string, InvoiceItem[]>();
  for (const item of items) {
    const key = unitKey(item.unit);
    const lines = byUnit.get(key) ?? [];
    lines.push(item);
    byUnit.set(key, lines);
  }
  return byUnit;
}

function compareMatchedGroup(group: OrderGroup): InvoiceComparisonRow[] {
  const byUnit = groupByInvoiceUnit(group.matches);
  const key = unitKey(group.unit);
  const firstUnit = unitKey(group.matches[0]?.unit ?? null);
  if (byUnit.size < 2 && (!key || !firstUnit || key === firstUnit)) {
    return [compareGroup(group, group.matches, false)];
  }

  const primary = byUnit.get(key) ?? [];
  byUnit.delete(key);
  return [
    compareGroup(group, primary, true),
    ...[...byUnit.values()].map((items) => invoiceOnlyRow(
      items, 'unit', group.skuCode,
      `Строки счёта ${sourceRows(items)} показаны отдельно из-за разных единиц для одной позиции.`,
    )),
  ];
}

export function compareInvoice(orders: readonly Order[], items: readonly InvoiceItem[]): InvoiceComparisonRow[] {
  if (new Set(orders.map((order) => order.supplier)).size > 1) {
    throw new Error('Для сверки нужны заказы одного поставщика.');
  }
  const groups = groupOrders(orders);
  const byCode = new Map<string, Set<OrderGroup>>();
  const byArticle = new Map<string, Set<OrderGroup>>();
  const byToken = new Map<string, Set<OrderGroup>>();
  for (const group of groups) {
    indexGroup(byCode, group.skuCode, group);
    for (const { article } of group.lines) {
      indexGroup(byArticle, articleKey(article), group);
      for (const token of articleTokens(article)) indexGroup(byToken, token, group);
    }
  }

  const extras = new Map<string, InvoiceItem[]>();
  const unresolved: InvoiceComparisonRow[] = [];
  for (const item of items) {
    const candidates = item.skuCode
      ? [...(byCode.get(item.skuCode) ?? [])]
      : findArticleGroups(item.article, byArticle, byToken);
    if (candidates.length === 0) {
      const key = JSON.stringify([item.skuCode ? ['code', item.skuCode] : ['article', articleKey(item.article)], unitKey(item.unit)]);
      const lines = extras.get(key) ?? [];
      lines.push(item);
      extras.set(key, lines);
      continue;
    }
    const units = candidates.filter((candidate) => item.unit && unitKey(candidate.unit) === unitKey(item.unit));
    const selected = candidates.length === 1
      ? candidates[0]
      : new Set(candidates.map((candidate) => candidate.skuCode)).size === 1 && units.length === 1
        ? units[0]
        : undefined;
    if (selected) {
      selected.matches.push(item);
    } else {
      for (const group of candidates) group.ambiguousRows.push(item.sourceRow);
      const codes = [...new Set(candidates.map((candidate) => candidate.skuCode))].join(', ');
      unresolved.push(invoiceOnlyRow([item], 'ambiguous', undefined,
        `Строка счёта ${item.sourceRow}: несколько возможных позиций заказа (Код 1С: ${codes}).`));
    }
  }

  return [
    ...groups.flatMap(compareMatchedGroup),
    ...unresolved,
    ...[...extras.values()].map((lines) => invoiceOnlyRow(lines, 'extra')),
  ];
}

export function adjustmentAmount(adjustment: InvoiceAdjustment, original: InvoiceComparisonRow): number | null {
  const { qty, price } = adjustment;
  if (qty === null || price === null || !Number.isFinite(qty) || !Number.isFinite(price)) return null;
  if (
    qty === original.invoiceQty && price === original.invoicePrice && original.invoiceAmount !== null &&
    !original.differences.includes('amount') && !original.differences.includes('signed')
  ) {
    return original.invoiceAmount;
  }
  return moneyProduct(qty, price);
}

export function buildInvoiceAdjustments(
  rows: readonly InvoiceComparisonRow[],
  mode: 'invoice' | 'order',
): InvoiceAdjustment[] {
  return rows.map((row) => {
    const qty = mode === 'order' ? row.orderQty ?? row.invoiceQty : row.invoiceQty ?? row.orderQty;
    const adjustment = {
      id: row.id,
      skuCode: row.skuCode,
      article: row.article,
      name: row.name,
      unit: row.unit,
      qty,
      price: row.invoicePrice ?? row.orderPrice,
      amount: null,
      included: qty !== null && qty >= 0 && row.invoiceQty !== null && row.invoiceQty >= 0 &&
        row.invoicePrice !== null && row.invoicePrice >= 0 && (row.invoiceAmount ?? 0) >= 0 &&
        !row.differences.some((difference) => MANUAL_DIFFERENCES.has(difference)),
    };
    return { ...adjustment, amount: adjustmentAmount(adjustment, row) };
  });
}
