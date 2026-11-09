import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../../src/components/AppErrorBoundary';

function BrokenComponent(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  it('shows a recovery message instead of a blank screen', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenComponent />
      </AppErrorBoundary>,
    );

    const alert = screen.getByRole('alert');

    expect(alert).toHaveTextContent('«Волмакс Буст» не смог продолжить работу');
    expect(alert).toHaveTextContent(
      /скачайте и распакуйте архив ORDERS_AUTO.zip целиком/i,
    );
    expect(alert).toHaveTextContent(/index\.html/i);
    errorSpy.mockRestore();
  });
});
