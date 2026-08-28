import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from '../../src/app/App';

it('shows application', async () => {
  render(<App />);

  expect(await screen.findByText('ORDERS_AUTO')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Импорт отчётов 1С' }),
  ).toBeInTheDocument();
});
