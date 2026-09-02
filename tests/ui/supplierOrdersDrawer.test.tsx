import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowOrder } from '../../src/app/selectors';
import { SupplierOrdersDrawer } from '../../src/features/orders/SupplierOrdersDrawer';

const COLUMN_WIDTHS_STORAGE_KEY = 'orders-auto:supplier-matrix-column-widths:v1';

function line(
  skuCode: string,
  branch: string,
  qty: number,
  price = 100,
) {
  return {
    skuCode,
    article: `ART-${skuCode}`,
    name: `Товар ${skuCode}`,
    branch,
    supplier: 'Поставщик А',
    calculatedQty: qty,
    orderQty: qty,
    unit: 'шт',
    unitPrice: price,
    priceSource: 'SUPPLIER_HISTORY' as const,
    amount: qty * price,
    warnings: [],
    stock: 0,
    min: 1,
    max: qty,
  };
}

function makeOrders(): WorkflowOrder[] {
  return [
    {
      id: 'Ленина\0Поставщик А',
      branch: 'Ленина',
      supplier: 'Поставщик А',
      lines: [line('SKU1', 'Ленина', 3), line('SKU2', 'Ленина', 2)],
      totalQty: 5,
      totalAmount: 500,
      belowThreshold: false,
      status: 'READY',
      blockers: [],
      reviewed: true,
      manualEditCount: 1,
    },
    {
      id: 'Ступино\0Поставщик А',
      branch: 'Ступино',
      supplier: 'Поставщик А',
      lines: [line('SKU1', 'Ступино', 4)],
      totalQty: 4,
      totalAmount: 400,
      belowThreshold: false,
      status: 'READY',
      blockers: [],
      reviewed: false,
      manualEditCount: 0,
    },
  ];
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('SupplierOrdersDrawer', () => {
  it('renders SKU rows with branch columns and cross-branch SKU totals', () => {
    render(
      <SupplierOrdersDrawer
        supplier="Поставщик А"
        orders={makeOrders()}
        branchOrder={['Ленина', 'Ступино']}
        onClose={() => undefined}
        onEdit={() => undefined}
        onSetReviewed={() => undefined}
        onSetAllReviewed={() => undefined}
      />,
    );

    const leninaHeader = screen.getByRole('columnheader', { name: /Ленина/i });
    const stupinoHeader = screen.getByRole('columnheader', { name: /Ступино/i });
    expect(leninaHeader).toBeInTheDocument();
    expect(stupinoHeader).toBeInTheDocument();
    expect(screen.getByText('ART-SKU1')).toBeInTheDocument();
    expect(screen.getByText('ART-SKU2')).toBeInTheDocument();

    const sku1Row = screen.getByText('ART-SKU1').closest('tr');
    expect(sku1Row).not.toBeNull();
    expect(sku1Row).toHaveTextContent('7');
    expect(sku1Row).toHaveTextContent('700');
    expect(leninaHeader).toHaveTextContent('500');
    expect(stupinoHeader).toHaveTextContent('400');
  });

  it('edits the concrete branch order from a SKU × branch cell', () => {
    const onEdit = vi.fn();
    const orders = makeOrders();
    render(
      <SupplierOrdersDrawer
        supplier="Поставщик А"
        orders={orders}
        branchOrder={['Ленина', 'Ступино']}
        onClose={() => undefined}
        onEdit={onEdit}
        onSetReviewed={() => undefined}
        onSetAllReviewed={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Количество SKU1 Ленина'), {
      target: { value: '5' },
    });

    expect(onEdit).toHaveBeenCalledWith(orders[0], 'SKU1', 5);
  });

  it('supports individual and supplier-wide review controls and shows manual edits', () => {
    const onSetReviewed = vi.fn();
    const onSetAllReviewed = vi.fn();
    const orders = makeOrders();
    render(
      <SupplierOrdersDrawer
        supplier="Поставщик А"
        orders={orders}
        branchOrder={['Ленина', 'Ступино']}
        onClose={() => undefined}
        onEdit={() => undefined}
        onSetReviewed={onSetReviewed}
        onSetAllReviewed={onSetAllReviewed}
      />,
    );

    expect(screen.getByText(/✋\s*1/)).toBeInTheDocument();
    const stupino = screen.getByRole('checkbox', { name: 'Проверен Ступино' });
    fireEvent.click(stupino);
    expect(onSetReviewed).toHaveBeenCalledWith(orders[1]!.id, true);

    fireEvent.click(screen.getByRole('button', { name: /отметить все проверенными/i }));
    expect(onSetAllReviewed).toHaveBeenCalledWith(
      orders.map((order) => order.id),
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: /снять проверку со всех/i }));
    expect(onSetAllReviewed).toHaveBeenCalledWith(
      orders.map((order) => order.id),
      false,
    );
  });

  it('exposes resizable headers and compact two-line nomenclature cells', () => {
    render(
      <SupplierOrdersDrawer
        supplier="Поставщик А"
        orders={makeOrders()}
        branchOrder={['Ленина', 'Ступино']}
        onClose={() => undefined}
        onEdit={() => undefined}
        onSetReviewed={() => undefined}
        onSetAllReviewed={() => undefined}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Изменить ширину столбца Код' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Изменить ширину столбца Артикул' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Изменить ширину столбца Номенклатура' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Изменить ширину столбца Ленина' }),
    ).toBeInTheDocument();

    const nomenclatureCell = screen.getByText('Товар SKU1');
    expect(nomenclatureCell).toHaveClass('supplier-name-cell');
    expect(nomenclatureCell).toHaveAttribute('title', 'Товар SKU1');
  });

  it('resizes a column from the keyboard and persists the preference', () => {
    render(
      <SupplierOrdersDrawer
        supplier="Поставщик А"
        orders={makeOrders()}
        branchOrder={['Ленина', 'Ступино']}
        onClose={() => undefined}
        onEdit={() => undefined}
        onSetReviewed={() => undefined}
        onSetAllReviewed={() => undefined}
      />,
    );

    const codeHeader = screen.getByRole('columnheader', { name: /Код/i });
    const resizer = screen.getByRole('button', {
      name: 'Изменить ширину столбца Код',
    });
    const initialWidth = Number.parseFloat(codeHeader.style.width);

    fireEvent.keyDown(resizer, { key: 'ArrowRight' });

    const resizedWidth = Number.parseFloat(codeHeader.style.width);
    expect(resizedWidth).toBeGreaterThan(initialWidth);
    const saved = JSON.parse(
      window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) ?? '{}',
    ) as Record<string, number>;
    expect(saved.code).toBe(resizedWidth);
  });

  it('resets user column widths to the content-based defaults', () => {
    render(
      <SupplierOrdersDrawer
        supplier="Поставщик А"
        orders={makeOrders()}
        branchOrder={['Ленина', 'Ступино']}
        onClose={() => undefined}
        onEdit={() => undefined}
        onSetReviewed={() => undefined}
        onSetAllReviewed={() => undefined}
      />,
    );

    const codeHeader = screen.getByRole('columnheader', { name: /Код/i });
    const resizer = screen.getByRole('button', {
      name: 'Изменить ширину столбца Код',
    });
    const initialWidth = Number.parseFloat(codeHeader.style.width);

    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(Number.parseFloat(codeHeader.style.width)).toBeGreaterThan(initialWidth);

    fireEvent.click(
      screen.getByRole('button', { name: 'Сбросить ширину столбцов' }),
    );

    expect(Number.parseFloat(codeHeader.style.width)).toBe(initialWidth);
    expect(window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
  });
});
