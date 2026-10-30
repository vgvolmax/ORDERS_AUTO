import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { QuantitySummary } from '../../src/components/QuantitySummary';

it('keeps units separate and counts unknown-unit products without adding incompatible quantities', () => {
  const { container } = render(
    <QuantitySummary
      rows={[
        { skuCode: 'A', qty: 2, unit: 'шт' },
        { skuCode: 'A', qty: 3, unit: 'шт' },
        { skuCode: 'B', qty: 20, unit: 'м' },
        { skuCode: 'C', qty: 7, unit: null },
        { skuCode: 'C', qty: 8, unit: null },
      ]}
    />,
  );
  expect(container).toHaveTextContent('5 шт');
  expect(container).toHaveTextContent('20 м');
  expect(container).toHaveTextContent('Без единицы: 1 SKU');
  expect(screen.queryByText('40')).not.toBeInTheDocument();
});
