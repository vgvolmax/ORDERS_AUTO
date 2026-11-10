import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { derive } from '../../src/app/selectors';
import { OrderDrawer } from '../../src/features/orders/OrderDrawer';
import { baseState } from './renderWithStore';

it('represents a long order without mounting every editable line', () => {
  const sample = derive(baseState()).projection.orders[0]!;
  const lines = Array.from({ length: 3043 }, (_, index) => ({
    ...sample.lines[0]!,
    skuCode: 'SKU-' + index,
  }));
  render(<OrderDrawer
    order={{ ...sample, lines }}
    exported={false}
    onClose={() => undefined}
    onEdit={() => undefined}
    onReviewedChange={() => undefined}
    onExport={() => undefined}
  />);
  const drawer = within(screen.getByRole('dialog', { name: 'Состав заказа' }));
  expect(drawer.getByRole('table')).toHaveAttribute('aria-rowcount', '3044');
  expect(drawer.queryAllByRole('spinbutton').length).toBeLessThan(100);
});
