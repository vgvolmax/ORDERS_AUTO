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

    expect(screen.getByRole('alert')).toHaveTextContent('ORDERS_AUTO не смог продолжить работу');
    expect(screen.getByText(/перезагрузите файл приложения/i)).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
