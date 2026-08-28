import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowOrder } from '../../src/app/selectors';
import { SupplierOrdersDrawer } from '../../src/features/orders/SupplierOrdersDrawer';

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

    expect(screen.getByRole('columnheader', { name: /Ленина/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Ступино/i })).toBeInTheDocument();
    expect(screen.getByText('ART-SKU1')).toBeInTheDocument();
    expect(screen.getByText('ART-SKU2')).toBeInTheDocument();

    const sku1Row = screen.getByText('ART-SKU1').closest('tr');
    expect(sku1Row).not.toBeNull();
    expect(sku1Row).toHaveTextContent('7');
    expect(sku1Row).toHaveTextContent('700');
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.getByText(/400/)).toBeInTheDocument();
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
});
