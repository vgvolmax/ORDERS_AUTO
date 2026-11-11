import { describe, expect, it } from 'vitest';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { createInitialState } from '../../src/app/initialState';
import { seedSupplierAssignments } from '../../src/domain/supplierAssignments';
import { derive } from '../../src/app/selectors';
import { buildWorkbook } from '../fixtures/workbookBuilders';
import {
  stateFromWorkspace,
  workspaceFromState,
} from '../../src/app/workspaceSession';
import { buildAcceptedTransferStatePatch } from '../../src/domain/rebalanceWorkflow';
import { buildSupplierWorkbook } from '../../src/export/supplierWorkbook';
import { orderToCsv } from '../../src/export/csv';
import * as XLSX from 'xlsx';
import type { OrderSettings } from '../../src/domain/types';

const supplier = 'ИП Баранов Роман Борисович';
const minHeader = [
  'Код',
  'Артикул',
  'Номенклатура',
  'Количество',
  'Минимальный остаток',
  'Максимальный остаток',
  'Цена',
];
const supHeader = [
  'Контрагент',
  'Код',
  'Номенклатура',
  'Количество',
  'Стоимость',
  'Ед. изм.',
];
const sku = (code = 'SKU1', price: unknown = 100) => [
  code,
  'A-' + code,
  'Товар ' + code,
  null,
  null,
  null,
  price,
];
const branch = (name = 'Ленина', stock: unknown = 0, max = 10) => [
  null,
  null,
  name,
  stock,
  Math.min(2, max),
  max,
  null,
];
const history = (code = 'SKU1', qty: unknown = 10, amount: unknown = 1000) => [
  supplier,
  code,
  'Товар ' + code,
  qty,
  amount,
  'шт',
];
function imported(
  minRows: unknown[][],
  supRows: unknown[][],
  settings: Partial<OrderSettings> = {},
) {
  const min = parseMinMaxWorkbook(buildWorkbook([minHeader, ...minRows]));
  const sup = parseSupplierWorkbook(buildWorkbook([supHeader, ...supRows]));
  if (!min.data || !sup.data) throw new Error('Fixture import failed');
  const state = createInitialState({
    minMax: min.data,
    suppliers: sup.data,
    supplierAssignments: seedSupplierAssignments(sup.data.history),
    minMaxIssues: min.issues,
    supplierIssues: sup.issues,
  });
  state.settings = { ...state.settings, ...settings };
  return { state, min, sup, result: derive(state) };
}

describe('calculation audit regressions: import → purchasing → orders', () => {
  it('excludes a negative MIN and diagnoses the same row in legacy snapshots without stored issues', () => {
    const x = imported([sku(), [null, null, 'Ленина', 0, -5, 10, null], branch('Ступино')], [history()]);
    for (const state of [x.state, { ...x.state, minMaxIssues: [] }]) {
      const result = derive(state);
      expect(result.projection.orders.map((order) => order.branch)).toEqual(['Ступино']);
      expect(result.projection.dataIssues).toContainEqual(expect.objectContaining({
        code: 'INVALID_NORM', skuCode: 'SKU1', branch: 'Ленина', severity: 'ERROR',
      }));
      expect(result.purchaseDemand.find((row) => row.branch === 'Ленина')?.purchaseStatus).toBe('INVALID_NORM');
    }
  });
  it('keeps fractional physical need exact at the monetary threshold', () => {
    const x = imported(
      [sku('SKU1', 1), branch('Ленина', 0.1, 0.3)],
      [history('SKU1', 1, 1)],
      { minimumOrderAmount: 0.2 },
    );
    expect(x.result.purchaseDemand[0]!.purchaseQty).toBe(0.2);
    expect(x.result.projection.orders[0]).toMatchObject({
      status: 'READY',
      totalAmount: 0.2,
    });
  });
  it.each([null, '', 'ошибка'])(
    'does not treat unknown supplier amount %j as a known zero',
    (amount) => {
      const x = imported([sku(), branch()], [history('SKU1', 10, amount)]);
      expect(x.sup.data!.history[0]!.weightedUnitCost).toBeNull();
      expect(x.sup.issues.some((i) => i.skuCode === 'SKU1')).toBe(true);
      expect(x.result.projection.orders[0]).toMatchObject({
        status: 'READY',
        totalAmount: 1000,
      });
      expect(x.result.purchaseDemand[0]).toMatchObject({
        unitPrice: 100,
        priceSource: 'MIN_MAX',
      });
    },
  );

  it('does not dilute weighted cost with partially missing amount', () => {
    const x = imported(
      [sku(), branch()],
      [history(), history('SKU1', 10, null)],
    );
    expect(x.sup.data!.history[0]!.weightedUnitCost).toBeNull();
    expect(x.result.projection.orders[0]!.totalAmount).toBe(1000);
  });

  it('does not inflate weighted cost with partially missing quantity', () => {
    const x = imported(
      [sku(), branch()],
      [history(), history('SKU1', null, 1000)],
    );
    expect(x.sup.data!.history[0]!.weightedUnitCost).toBeNull();
    expect(x.result.projection.orders[0]!.totalAmount).toBe(1000);
  });

  it('blocks a missing MIN/MAX price even when the initial report has a price', () => {
    const x = imported(
      [sku('SKU1', null), branch()],
      [history('SKU1', 10, 1000)],
    );
    expect(x.result.projection.orders[0]).toMatchObject({
      status: 'BLOCKED',
      totalAmount: null,
    });
    expect(x.result.projection.orders[0]!.blockers).toContain(
      'Не хватает цены',
    );
  });

  it('keeps explicitly known zero MIN/MAX cost valid', () => {
    const x = imported([sku('SKU1', 0), branch()], [history('SKU1', 10, 1000)]);
    expect(x.result.projection.orders[0]).toMatchObject({
      status: 'READY',
      totalAmount: 0,
    });
    expect(x.result.purchaseDemand[0]!.priceSource).toBe('MIN_MAX');
  });

  it('preserves signed returns in a complete supplier history', () => {
    const x = imported(
      [sku(), branch()],
      [history(), history('SKU1', -2, -200)],
    );
    expect(x.sup.data!.history[0]).toMatchObject({
      purchaseQty: 8,
      purchaseAmount: 800,
      weightedUnitCost: 100,
    });
  });

  it('does not accumulate binary errors in weighted supplier price', () => {
    const x = imported(
      [sku('SKU1', 15.15), branch('Ленина', 0, 2)],
      [history('SKU1', 1, 10.1), history('SKU1', 1, 20.2)],
      { minimumOrderAmount: 30.3 },
    );
    expect(x.sup.data!.history[0]!.weightedUnitCost).toBe(15.15);
    expect(x.result.projection.orders[0]).toMatchObject({
      status: 'READY',
      totalAmount: 30.3,
    });
  });

  it('hard-blocks an ambiguous physical branch while keeping an independent order ready', () => {
    const x = imported(
      [sku(), branch('Ленина', 0), branch('Ленина', 8), branch('Ступино', 0)],
      [history()],
    );
    const affected = x.result.projection.orders.find(
      (o) => o.branch === 'Ленина',
    )!;
    expect(affected.status).toBe('BLOCKED');
    expect(affected.blockers.some((b) => b !== 'Ниже минимальной суммы')).toBe(
      true,
    );
    expect(
      x.result.projection.orders.find((o) => o.branch === 'Ступино')!.status,
    ).toBe('READY');
    expect(
      derive(
        stateFromWorkspace(structuredClone(workspaceFromState(x.state))),
      ).projection.orders.find((o) => o.branch === 'Ленина')!.status,
    ).toBe('BLOCKED');
  });

  it('retains a malformed omitted branch as a purchasing issue without inventing demand', () => {
    const x = imported(
      [sku(), branch('Ленина'), branch('Ступино', 'ошибка')],
      [history()],
    );
    expect(x.result.projection.dataIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_BRANCH_VALUES',
          skuCode: 'SKU1',
          branch: 'Ступино',
        }),
      ]),
    );
    expect(x.result.purchaseDemand.some((l) => l.branch === 'Ступино')).toBe(
      false,
    );
    expect(x.result.projection.orders[0]!.status).toBe('READY');
  });

  it('diagnoses repeated parent codes and never chooses their last fallback price', () => {
    const x = imported(
      [sku('SKU1', 100), branch('Ленина'), sku('SKU1', 200), branch('Ступино')],
      [history('SKU1', 0, 0)],
    );
    expect(x.min.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_SKU', skuCode: 'SKU1' }),
      ]),
    );
    expect(x.result.purchaseDemand.every((l) => l.unitPrice === null)).toBe(
      true,
    );
    expect(
      x.result.projection.orders.every((o) => o.status === 'BLOCKED'),
    ).toBe(true);
  });

  it('detects duplicate parent codes in older normalized sessions without parser diagnostics', () => {
    const x = imported([sku(), branch()], [history()]);
    x.state.minMax!.skus.push({
      ...x.state.minMax!.skus[0]!,
      referencePrice: 200,
    });
    const result = derive({ ...x.state });
    expect(result.projection.orders[0]!.status).toBe('BLOCKED');
    expect(result.projection.dataIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_SKU' }),
      ]),
    );
  });

  it('detects duplicate physical slices in older normalized sessions before building purchase demand', () => {
    const x = imported([sku(), branch()], [history()]);
    x.state.minMax!.branchStocks.push({
      ...x.state.minMax!.branchStocks[0]!,
      stock: 8,
    });
    const result = derive({ ...x.state });
    expect(result.projection.orders.every((o) => o.status !== 'READY')).toBe(
      true,
    );
    expect(result.projection.dataIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_SKU_BRANCH' }),
      ]),
    );
  });

  it('retains data blockers while applying purchasing workflow changes', () => {
    const x = imported(
      [sku(), branch('Ленина', 0), branch('Ленина', 8)],
      [history()],
    );
    const order = x.result.projection.orders[0]!;
    const patch = buildAcceptedTransferStatePatch({
      previousDemand: x.result.purchaseDemand,
      nextDemand: x.result.purchaseDemand,
      previousProjection: x.result.projection,
      resolutions: x.result.resolutions,
      settings: x.state.settings,
      edits: [],
      reviewedOrderIds: [order.id],
      exportedOrderIds: [order.id],
    });
    expect(patch.affectedOrderIds).toEqual([]);
  });

  it('never subtracts a negative fallback price from a positive mixed order', () => {
    const x = imported(
      [sku('SKU1', -100), branch(), sku('SKU2', 200), branch()],
      [history('SKU1', 0, 0), history('SKU2', 10, 2000)],
    );
    expect(
      x.result.purchaseDemand.find((l) => l.skuCode === 'SKU1')!.unitPrice,
    ).toBeNull();
    expect(x.result.projection.orders[0]).toMatchObject({
      status: 'BLOCKED',
      totalAmount: null,
    });
    expect(x.result.projection.orders[0]!.blockers).toContain(
      'Не хватает цены',
    );
  });

  it.each(['SUPPLIER_TOTAL', 'BRANCH_SUPPLIER'] as const)(
    'accepts an exact decimal boundary in %s mode',
    (thresholdMode) => {
      const x = imported(
        [
          sku('SKU1', 10.1),
          branch('Ленина', 0, 1),
          sku('SKU2', 20.2),
          branch(
            thresholdMode === 'SUPPLIER_TOTAL' ? 'Ступино' : 'Ленина',
            0,
            1,
          ),
        ],
        [history('SKU1', 1, 10.1), history('SKU2', 1, 20.2)],
        { thresholdMode, minimumOrderAmount: 30.3 },
      );
      expect(
        x.result.projection.orders.every(
          (o) => o.status === 'READY' && !o.belowThreshold,
        ),
      ).toBe(true);
    },
  );

  it('does not accept a genuinely lower sub-cent amount by rounding or epsilon', () => {
    const x = imported(
      [sku('SKU1', 30.299999999), branch('Ленина', 0, 1)],
      [history('SKU1', 1, 100)],
      { minimumOrderAmount: 30.3 },
    );
    expect(x.result.projection.orders[0]!.belowThreshold).toBe(true);
  });

  it('uses exact edited products and exports the same decimal totals', async () => {
    const x = imported(
      [
        sku('SKU1', 0.1),
        branch('Ленина', 0, 1),
        sku('SKU2', 0.2),
        branch('Ленина', 0, 1),
      ],
      [history('SKU1', 1, 0.1), history('SKU2', 1, 0.2)],
    );
    x.state.edits = [
      { skuCode: 'SKU1', branch: 'Ленина', qty: 3 },
      { skuCode: 'SKU2', branch: 'Ленина', qty: 1 },
    ];
    x.state.settings.minimumOrderAmount = 0.5;
    const order = derive({ ...x.state }).projection.orders[0]!;
    expect(order.lines[0]!.amount).toBe(0.3);
    expect(order.totalAmount).toBe(0.5);
    expect(order.status).toBe('READY');
    expect(orderToCsv(order)).not.toContain('0.30000000000000004');
    const buffer = await buildSupplierWorkbook(supplier, [order]);
    const book = XLSX.read(buffer, { type: 'array' });
    expect(book.Sheets['Общий заказ']!['A6'].v).toBe(0.5);
  });
});
