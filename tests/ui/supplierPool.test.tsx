import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { derive } from '../../src/app/selectors';
import { applySupplierAssignmentChange } from '../../src/domain/supplierAssignments';
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
  return baseState({
    suppliers: {
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
    },
  });
}

describe('approved supplier pool', () => {
  it('offers all 32 suppliers regardless of history and prices the explicit choice from MIN/MAX', () => {
    const state = poolState();
    state.suppliers!.history[0]!.weightedUnitCost = 85;
    const set = vi.fn();
    renderWithStore(<SuppliersPage />, state, set);
    fireEvent.click(screen.getByRole('button', { name: 'Связи SKU1' }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText('Основной поставщик');
    expect(
      within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['', ...approved]);
    const absentFromHistory = 'ООО "Ютара"';
    fireEvent.change(select, { target: { value: absentFromHistory } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сделать основным' }));
    const patch = set.mock.calls[0]![0];
    expect(patch.supplierAssignments).toEqual([
      { skuCode: 'SKU1', primary: absentFromHistory, additional: [allowed, otherAllowed] },
    ]);
    const result = derive({ ...state, ...patch });
    expect(result.projection.unassigned).toEqual([]);
    expect(result.projection.orders.map((order) => order.totalAmount)).toEqual([700, 400]);
    for (const order of result.projection.orders) {
      expect(order.status).toBe('READY');
      expect(order.lines[0]).toMatchObject({ supplier: absentFromHistory, unitPrice: 100, priceSource: 'MIN_MAX' });
    }
    expect(state.suppliers!.history.map((row) => row.supplier)).toEqual([allowed, otherAllowed, hidden]);
  });

  it.each([null, 0])('distinguishes missing and zero MIN/MAX price even with history: %s', (price) => {
    const state = poolState([allowed]);
    state.minMax!.skus[0]!.referencePrice = price;
    const result = derive(state);
    expect(result.projection.unassigned).toEqual([]);
    expect(result.projection.orders).toHaveLength(2);
    expect(result.projection.orders.every((order) => order.status === (price === null ? 'BLOCKED' : 'READY'))).toBe(true);
    expect(result.projection.orders[0]!.lines[0]!.unitPrice).toBe(price);
  });

  it('offers an assigned supplier in demand filters even when absent from the imported report', () => {
    const state = poolState([]);
    state.supplierAssignments = [{ skuCode: 'SKU1', primary: allowed, additional: [] }];
    renderWithStore(<DemandPage />, state);
    const filter = screen.getByRole('combobox', { name: 'Поставщик' });
    expect(within(filter).getByRole('option', { name: allowed })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: allowed } });
    expect(screen.getByText('Товар 1')).toBeInTheDocument();
  });

  it.each([
    ['ООО «ТЕРЕМ»', allowed, allowed],
    ['', otherAllowed, ''],
  ])('keeps demand visible with canonical or unavailable saved supplier filter %s', (importedName, primary, expected) => {
    const state = poolState(importedName ? [importedName] : []);
    state.supplierAssignments = [{ skuCode: 'SKU1', primary, additional: [] }];
    state.uiPreferences['demand:all:filters'] = { ...emptyDemandFilters, supplier: 'ООО «ТЕРЕМ»' };
    renderWithStore(<DemandPage />, state);
    expect(screen.getByRole('combobox', { name: 'Поставщик' })).toHaveValue(expected);
    expect(screen.getByText('Товар 1')).toBeInTheDocument();
  });

  it('keeps exactly the 32 approved suppliers as additional when more than one was present', () => {
    const state = poolState([...approved, hidden]);
    const before = structuredClone(state);
    expect(state.supplierAssignments).toEqual([
      { skuCode: 'SKU1', primary: null, additional: approved },
    ]);
    const result = derive(state);
    expect(result.resolutions[0]).toMatchObject({ status: 'MANUAL_REQUIRED', recommendedSupplier: null });
    expect(result.projection.orders).toEqual([]);
    expect(state).toEqual(before);
  });

  it.each([
    ['  ооо «ТЕРЕМ»  ', allowed],
    ['ООО"Терем"', allowed],
    ['ООО ИНЖЕНЕРНЫЙ ЦЕНТР АПРЕЛЬ', 'ООО "ИНЖЕНЕРНЫЙ ЦЕНТР "АПРЕЛЬ"'],
    ['ип   жовтый сергей юрьевич', 'Ип Жовтый Сергей Юрьевич'],
  ])('uses the fixed pool name for presentation-only name variation: %s', (supplier, canonical) => {
    expect(derive(poolState([supplier])).resolutions[0]).toMatchObject({
      selectedSupplier: canonical,
    });
  });

  it.each([hidden, 'ООО "Терем Плюс"', 'ИП Терем'])('does not admit a different supplier: %s', (supplier) => {
    const state = poolState([supplier]);
    const result = derive(state);
    expect(result.resolutions[0]).toMatchObject({
      candidates: [],
      recommendedSupplier: null,
      selectedSupplier: null,
      status: 'UNRESOLVED',
    });
    expect(result.projection.orders).toEqual([]);
    expect(result.projection.unassigned).toHaveLength(2);
    expect(result.purchaseDemand.reduce((sum, line) => sum + line.purchaseQty, 0)).toBe(11);
    expect(applySupplierAssignmentChange(state.supplierAssignments!, {
      kind: 'set-primary', skuCodes: ['SKU1'], supplier,
    })).toEqual([]);
  });

  it('uses the same pool for import readiness when the report contains only hidden suppliers', () => {
    renderWithStore(<ImportPage />, poolState([hidden]));
    expect(screen.getByText(/без основного поставщика/i)).toHaveTextContent('1');
  });

  it('hides excluded filter options and ignores a saved hidden supplier filter without losing demand', () => {
    const state = poolState([allowed, hidden]);
    state.uiPreferences['demand:all:filters'] = { ...emptyDemandFilters, supplier: hidden };
    renderWithStore(<DemandPage />, state);
    const filter = screen.getByRole('combobox', { name: 'Поставщик' });
    expect(within(filter).queryByRole('option', { name: hidden })).not.toBeInTheDocument();
    expect(filter).toHaveValue('');
    expect(screen.getByText('Товар 1')).toBeInTheDocument();
  });
});
