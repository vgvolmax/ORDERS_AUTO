import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { derive } from '../../src/app/selectors';
import { buildAutoSupplierOverrides } from '../../src/domain/supplierAutomation';
import { emptyDemandFilters } from '../../src/components/FiltersBar';
import { DemandPage } from '../../src/features/demand/DemandPage';
import { ImportPage } from '../../src/features/import/ImportPage';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { baseState, renderWithStore } from './renderWithStore';

// The operator's approved list is the acceptance fixture, independent of runtime configuration.
const approved = [
  'АО ТД "ЭЛЕКТРОТЕХМОНТАЖ"',
  'ИП Баранов Роман Борисович',
  'ИП Бобров Э.Р.',
  'Ип Жовтый Сергей Юрьевич',
  'ИП Никишин Андрей Николаевич',
  'Ип Рязанцева Надежда Леонидовна',
  'ООО "Авангард Система"',
  'ООО "Акварио Рус"',
  'ООО "Алмаз"',
  'ООО "Вера Саша и Олег"',
  'ООО "ВЕРДЕ"',
  'ООО "ВЕРСУС ГРУПП"',
  'ООО "ДЕНСАН"',
  'ООО "Ева"',
  'ООО "ИНЖЕНЕРНЫЙ ЦЕНТР "АПРЕЛЬ"',
  'ООО "Мир инструмента"',
  'ООО "Р-КЛИМАТ"',
  'ООО "РЕСУРС ФОРВАРДИНГ"',
  'ООО "САНСФЕРА-РУС"',
  'ООО "САНТЕХГРУПП"',
  'ООО "Сантехкомплект"',
  'ООО "СТД-ПРО"',
  'ООО "ТЕПЛОТЕХНИКАСЕРВИС"',
  'ООО "Теплотренд"',
  'ООО "Терем"',
  'ООО "Термаснаб"',
  'ООО "Торговый Дом Импульс"',
  'ООО "ФАХМАНН РУССЛАНД"',
  'ООО "ЭмВиАй"',
  'ООО "ЮЗТК"',
  'ООО "Ютара"',
  'ООО ТД "БИОСЕПТИК"',
];
const allowed = 'ООО "Терем"';
const otherAllowed = 'ООО "Алмаз"';
const hidden = 'ООО "Скрытый поставщик"';

function poolState(names = [allowed, otherAllowed, hidden]) {
  const state = baseState();
  state.suppliers = {
    suppliers: names,
    history: names.map((supplier, index) => ({
      supplier,
      skuCode: 'SKU1',
      skuName: 'Товар 1',
      unit: 'шт',
      purchaseQty: 100 + index,
      purchaseAmount: (100 + index) * Math.max(1, 100 - index * 40),
      weightedUnitCost: Math.max(1, 100 - index * 40),
    })),
  };
  return state;
}

describe('approved supplier pool', () => {
  it('offers all 32 suppliers without history and prices the explicit choice from MIN/MAX', async () => {
    const state = poolState([]);
    const set = vi.fn();
    renderWithStore(<SuppliersPage />, state, set);
    const select = screen.getByRole('combobox', { name: 'Поставщик SKU1' });
    expect(within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value))
      .toEqual(['', ...approved]);
    expect(screen.getByRole('button', { name: 'Применить автовыбор' })).toBeDisabled();
    fireEvent.change(select, { target: { value: allowed } });
    const patch = set.mock.calls[0]![0];
    expect(patch.overrides[0]).toMatchObject({ supplier: allowed, source: 'MANUAL', allowWithoutHistory: true });
    const result = derive({ ...state, ...patch });
    expect(result.resolutions[0]).toMatchObject({ selectedSupplier: allowed, status: 'MANUAL_SELECTED', candidates: [] });
    expect(result.projection.unassigned).toEqual([]);
    expect(result.projection.orders).toHaveLength(2);
    expect(result.projection.orders.map((order) => order.totalAmount)).toEqual([700, 400]);
    for (const order of result.projection.orders) {
      expect(order.status).toBe('READY');
      expect(order.lines[0]).toMatchObject({ supplier: allowed, unitPrice: 100, priceSource: 'MIN_MAX_FALLBACK' });
    }
    expect(state.suppliers!.history).toEqual([]);
  });

  it.each([null, 0])('keeps existing fallback semantics when MIN/MAX price is %s', (price) => {
    const state = poolState([]);
    state.minMax!.skus[0]!.referencePrice = price;
    state.overrides = [{ skuCode: 'SKU1', supplier: allowed, source: 'MANUAL', allowWithoutHistory: true, updatedAt: '2026-11-03' }];
    const result = derive(state);
    expect(result.projection.unassigned).toEqual([]);
    expect(result.projection.orders).toHaveLength(2);
    expect(result.projection.orders.every((order) => order.status === (price === null ? 'BLOCKED' : 'READY'))).toBe(true);
    expect(result.projection.orders[0]!.lines[0]!.unitPrice).toBe(price);
  });

  it.each(['MANUAL', 'AUTO'] as const)('never authorizes an out-of-pool %s assignment without history', (source) => {
    const state = poolState([]);
    state.overrides = [{ skuCode: 'SKU1', supplier: hidden, source, allowWithoutHistory: true, updatedAt: '2026-11-03' }];
    expect(derive(state).resolutions[0]!.status).toBe('STALE_OVERRIDE');
    expect(derive(state).projection.orders).toEqual([]);
  });

  it('keeps disappeared historical and automated selections stale until explicitly confirmed', () => {
    for (const override of [
      { supplier: allowed },
      { supplier: allowed, source: 'MANUAL' as const },
      { supplier: allowed, source: 'AUTO' as const, allowWithoutHistory: true },
    ]) {
      const state = poolState([]);
      state.overrides = [{ ...override, skuCode: 'SKU1', updatedAt: '2026-11-03' }];
      expect(derive(state).resolutions[0]!.status).toBe('STALE_OVERRIDE');
    }
  });

  it('uses supplier history when it later becomes available for the explicit pool assignment', () => {
    const importedName = 'ООО «ТЕРЕМ»';
    const state = poolState([importedName]);
    state.suppliers!.history[0]!.weightedUnitCost = 85;
    state.overrides = [{ skuCode: 'SKU1', supplier: allowed, source: 'MANUAL', allowWithoutHistory: true, updatedAt: '2026-11-03' }];
    expect(derive(state).demand[0]).toMatchObject({ selectedSupplier: importedName, unitPrice: 85, priceSource: 'SUPPLIER_HISTORY' });
  });

  it('keeps one order per branch when the pool choice matches the imported name of another SKU', () => {
    const importedName = 'ООО «ТЕРЕМ»';
    const state = poolState([importedName]);
    state.suppliers!.history[0]!.skuCode = 'SKU2';
    state.minMax!.skus.push({ ...state.minMax!.skus[0]!, code: 'SKU2' });
    state.minMax!.branchStocks.push({ ...state.minMax!.branchStocks[0]!, skuCode: 'SKU2' });
    state.overrides = [{ skuCode: 'SKU1', supplier: allowed, source: 'MANUAL', allowWithoutHistory: true, updatedAt: '2026-11-03' }];
    const result = derive(state);
    expect(result.projection.orders).toHaveLength(2);
    const lenina = result.projection.orders.find((order) => order.branch === 'Ленина')!;
    expect(lenina.supplier).toBe(importedName);
    expect(lenina.lines.map((line) => [line.skuCode, line.priceSource])).toEqual([
      ['SKU1', 'MIN_MAX_FALLBACK'],
      ['SKU2', 'SUPPLIER_HISTORY'],
    ]);
  });

  it('offers the manually assigned supplier in demand filters even when absent from the imported report', () => {
    const state = poolState([]);
    state.overrides = [{ skuCode: 'SKU1', supplier: allowed, source: 'MANUAL', allowWithoutHistory: true, updatedAt: '2026-11-03' }];
    renderWithStore(<DemandPage />, state);
    const filter = screen.getByRole('combobox', { name: 'Поставщик' });
    expect(within(filter).getByRole('option', { name: allowed })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: allowed } });
    expect(screen.getByText('Товар 1')).toBeInTheDocument();
  });

  it.each(['ООО «ТЕРЕМ»', ''])(
    'keeps demand visible when the saved supplier filter option changes to %s',
    (importedName) => {
      const state = poolState(importedName ? [importedName] : []);
      state.overrides = [{
        skuCode: 'SKU1',
        supplier: importedName ? allowed : otherAllowed,
        source: 'MANUAL',
        allowWithoutHistory: true,
        updatedAt: '2026-11-03',
      }];
      state.uiPreferences['demand:all:filters'] = { ...emptyDemandFilters, supplier: allowed };
      renderWithStore(<DemandPage />, state);
      expect(screen.getByRole('combobox', { name: 'Поставщик' })).toHaveValue(importedName);
      expect(screen.getByText('Товар 1')).toBeInTheDocument();
    },
  );

  it('keeps exactly the 32 approved suppliers and preserves imported history', () => {
    const state = poolState([...approved, hidden]);
    const before = structuredClone(state);
    const result = derive(state);
    expect(
      new Set(result.resolutions[0]!.candidates.map((c) => c.supplier)),
    ).toEqual(new Set(approved));
    expect(result.resolutions[0]!.status).toBe('MANUAL_REQUIRED');
    expect(state).toEqual(before);
  });

  it.each([
    '  ооо\u00a0«ТЕРЕМ»  ',
    'ООО"Терем"',
    'ООО ИНЖЕНЕРНЫЙ ЦЕНТР АПРЕЛЬ',
    'ип   жовтый сергей юрьевич',
  ])('allows presentation-only name variation: %s', (supplier) => {
    expect(derive(poolState([supplier])).resolutions[0]).toMatchObject({
      status: 'AUTO_SINGLE',
      selectedSupplier: supplier,
    });
  });

  it.each([hidden, 'ООО "Терем Плюс"', 'ИП Терем'])(
    'does not admit a different supplier: %s',
    (supplier) => {
      const result = derive(poolState([supplier]));
      expect(result.resolutions[0]).toMatchObject({
        candidates: [],
        recommendedSupplier: null,
        selectedSupplier: null,
        status: 'UNRESOLVED',
      });
      expect(result.projection.orders).toEqual([]);
      expect(result.projection.unassigned).toHaveLength(2);
      expect(
        result.purchaseDemand.reduce((sum, line) => sum + line.purchaseQty, 0),
      ).toBe(11);
    },
  );

  it('excludes hidden suppliers from recommendations, minimum-price automation, pricing and orders', () => {
    const state = poolState();
    const resolutions = derive(state).resolutions;
    expect(resolutions[0]!.recommendedSupplier).toBe(otherAllowed);
    const overrides = buildAutoSupplierOverrides({
      resolutions,
      currentOverrides: [],
      selectedSkuCodes: [],
      scope: 'ALL',
      strategy: 'MIN_PRICE',
      overwriteManual: false,
    });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.supplier).toBe(otherAllowed);
    const next = derive({ ...state, overrides });
    expect(next.projection.orders.map((order) => order.supplier)).toEqual([
      otherAllowed,
      otherAllowed,
    ]);
    expect(
      next.projection.orders.every((order) =>
        order.lines.every((line) => line.unitPrice === 60),
      ),
    ).toBe(true);
  });

  it.each(['MANUAL', 'AUTO'] as const)(
    'blocks an old %s choice outside the pool without silently replacing it',
    (source) => {
      const state = poolState([allowed, hidden]);
      state.overrides = [
        { skuCode: 'SKU1', supplier: hidden, source, updatedAt: '2026-10-01' },
      ];
      const result = derive(state);
      expect(result.resolutions[0]).toMatchObject({
        status: 'STALE_OVERRIDE',
        selectedSupplier: null,
      });
      expect(result.projection.orders).toEqual([]);
      expect(state.overrides[0]!.supplier).toBe(hidden);
      renderWithStore(<SuppliersPage />, state);
      const select = screen.getByRole('combobox', { name: 'Поставщик SKU1' });
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => (option as HTMLOptionElement).value),
      ).toEqual(['', allowed]);
    },
  );

  it('offers only allowed manual candidates and writes the chosen imported supplier name', () => {
    const set = vi.fn();
    renderWithStore(<SuppliersPage />, poolState(), set);
    const select = screen.getByRole('combobox', { name: 'Поставщик SKU1' });
    expect(
      within(select).queryByRole('option', { name: new RegExp(hidden) }),
    ).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: allowed } });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: [expect.objectContaining({ supplier: allowed })],
      }),
    );
  });

  it('uses the same pool for import readiness, including a report containing only hidden suppliers', () => {
    renderWithStore(<ImportPage />, poolState([hidden]));
    expect(screen.getByText(/нет поставщика:/i)).toHaveTextContent('1');
  });

  it('hides excluded filter options and ignores a saved hidden supplier filter without losing demand', () => {
    const state = poolState([allowed, hidden]);
    state.uiPreferences['demand:all:filters'] = {
      ...emptyDemandFilters,
      supplier: hidden,
    };
    renderWithStore(<DemandPage />, state);
    const filter = screen.getByRole('combobox', { name: 'Поставщик' });
    expect(
      within(filter).queryByRole('option', { name: hidden }),
    ).not.toBeInTheDocument();
    expect(filter).toHaveValue('');
    expect(screen.getByText('Товар 1')).toBeInTheDocument();
  });
});
