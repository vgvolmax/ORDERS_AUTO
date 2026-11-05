import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from '../../src/app/App';

it('shows application', async () => {
  render(<App />);

  expect(
    await screen.findByRole('img', { name: 'Волмакс Буст' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Импорт отчётов 1С' }),
  ).toBeInTheDocument();
});
