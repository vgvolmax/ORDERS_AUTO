import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import type { AppState } from '../../src/app/appStore';
import { baseState, renderWithStore } from './renderWithStore';

const mocks = vi.hoisted(() => ({
  saveSupplierOverride: vi.fn(),
  saveSupplierOverrides: vi.fn(),
}));

vi.mock('../../src/persistence/supplierOverrides', () => ({
  saveSupplierOverride: mocks.saveSupplierOverride,
  saveSupplierOverrides: mocks.saveSupplierOverrides,
}));

function ambiguousState(): AppState {
  return baseState({
    minMax: {
      skus: [
        {
          code: 'SKU1',
          article: 'A-1',
          name: 'Товар 1',
          referencePrice: 120,
          reportedTotalStock: 0,
        },
        {
          code: 'SKU2',
          article: 'A-2',
          name: 'Товар 2',
          referencePrice: 90,
          reportedTotalStock: 0,
        },
      ],
      branchStocks: [
        { skuCode: 'SKU1', branch: 'Ленина', stock: 0, min: 2, max: 10 },
        { skuCode: 'SKU2', branch: 'Ленина', stock: 0, min: 2, max: 8 },
      ],
      branches: ['Ленина'],
    },
    suppliers: {
      suppliers: ['Дорогой', 'Дешёвый'],
      history: [
        {
          supplier: 'Дорогой',
          skuCode: 'SKU1',
          skuName: 'Товар 1',
          unit: 'шт',
          purchaseQty: 100,
          purchaseAmount: 12_000,
          weightedUnitCost: 120,
        },
        {
          supplier: 'Дешёвый',
          skuCode: 'SKU1',
          skuName: 'Товар 1',
          unit: 'шт',
          purchaseQty: 10,
          purchaseAmount: 900,
          weightedUnitCost: 90,
        },
        {
          supplier: 'Дорогой',
          skuCode: 'SKU2',
          skuName: 'Товар 2',
          unit: 'шт',
          purchaseQty: 40,
          purchaseAmount: 4_000,
          weightedUnitCost: 100,
        },
        {
          supplier: 'Дешёвый',
          skuCode: 'SKU2',
          skuName: 'Товар 2',
          unit: 'шт',
          purchaseQty: 5,
          purchaseAmount: 350,
          weightedUnitCost: 70,
        },
      ],
    },
  });
}

describe('SuppliersPage', () => {
  beforeEach(() => {
    mocks.saveSupplierOverride.mockReset();
    mocks.saveSupplierOverride.mockResolvedValue('SKU1');
    mocks.saveSupplierOverrides.mockReset();
    mocks.saveSupplierOverrides.mockResolvedValue(undefined);
  });

  it('shows below-MIN count and never presents an incomplete amount as complete', () => {
    const state = baseState({
      minMax: {
        skus: [
          {
            code: 'SKU1',
            article: 'A-1',
            name: 'Товар 1',
            referencePrice: null,
            reportedTotalStock: 3,
          },
        ],
        branchStocks: [
          { skuCode: 'SKU1', branch: 'Ленина', stock: 3, min: 5, max: 10 },
        ],
        branches: ['Ленина'],
      },
      suppliers: {
        suppliers: ['Поставщик А'],
        history: [
          {
            supplier: 'Поставщик А',
            skuCode: 'SKU1',
            skuName: 'Товар 1',
            unit: 'шт',
            purchaseQty: 0,
            purchaseAmount: 0,
            weightedUnitCost: null,
          },
        ],
      },
    });

    renderWithStore(<SuppliersPage />, state);

    expect(screen.getByText('SKU ниже MIN')).toBeInTheDocument();
    expect(screen.getAllByText(/сумма неизвестна/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/без цены:\s*1/i)).toBeInTheDocument();
  });

  it('collapses the full decision list without losing row selection', () => {
    renderWithStore(<SuppliersPage />, ambiguousState());

    const sku1 = screen.getByRole('checkbox', { name: /выбрать SKU1/i });
    fireEvent.click(sku1);
    expect(sku1).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /свернуть.*требуют решения/i }));
    expect(screen.queryByText('Код SKU1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /развернуть.*требуют решения/i }));
    expect(screen.getByRole('checkbox', { name: /выбрать SKU1/i })).toBeChecked();
  });

  it('previews and applies minimum-price automation only to selected rows', async () => {
    const set = vi.fn();
    renderWithStore(<SuppliersPage />, ambiguousState(), set);

    fireEvent.click(screen.getByRole('checkbox', { name: /выбрать SKU1/i }));
    fireEvent.change(screen.getByLabelText(/область применения/i), {
      target: { value: 'SELECTED' },
    });

    expect(screen.getByText(/будет назначено:\s*1/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /применить автовыбор/i }));

    await waitFor(() => expect(mocks.saveSupplierOverrides).toHaveBeenCalledTimes(1));
    expect(mocks.saveSupplierOverrides).toHaveBeenCalledWith([
      expect.objectContaining({
        skuCode: 'SKU1',
        supplier: 'Дешёвый',
        source: 'AUTO',
      }),
    ]);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: [
          expect.objectContaining({
            skuCode: 'SKU1',
            supplier: 'Дешёвый',
            source: 'AUTO',
          }),
        ],
      }),
    );
  });

  it('supports all-except-selected scope', () => {
    renderWithStore(<SuppliersPage />, ambiguousState());

    fireEvent.click(screen.getByRole('checkbox', { name: /выбрать SKU1/i }));
    fireEvent.change(screen.getByLabelText(/область применения/i), {
      target: { value: 'EXCEPT_SELECTED' },
    });

    expect(screen.getByText(/будет назначено:\s*1/i)).toBeInTheDocument();
  });
});
