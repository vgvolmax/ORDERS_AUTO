import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QuantityInput } from '../../src/components/QuantityInput';
it('preserves fast typing while earlier durable quantity writes are pending', async () => {
  const pending: (() => void)[] = [],
    save = vi.fn(() => new Promise<void>((done) => pending.push(done)));
  const view = render(
    <QuantityInput aria-label="Количество" value={35} onCommit={save} />,
  );
  fireEvent.change(screen.getByLabelText('Количество'), {
    target: { value: '4' },
  });
  fireEvent.change(screen.getByLabelText('Количество'), {
    target: { value: '40' },
  });
  expect(screen.getByLabelText('Количество')).toHaveValue(40);
  await act(async () => pending[0]!());
  view.rerender(
    <QuantityInput aria-label="Количество" value={4} onCommit={save} />,
  );
  expect(screen.getByLabelText('Количество')).toHaveValue(40);
  await act(async () => pending[1]!());
  view.rerender(
    <QuantityInput aria-label="Количество" value={40} onCommit={save} />,
  );
  expect(screen.getByLabelText('Количество')).toHaveValue(40);
});
it('rolls back a rejected final write and lets an empty draft be corrected without ordering zero', async () => {
  const save = vi.fn().mockRejectedValue(new Error('quota'));
  render(<QuantityInput aria-label="Количество" value={35} onCommit={save} />);
  fireEvent.change(screen.getByLabelText('Количество'), {
    target: { value: '' },
  });
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Количество'), {
    target: { value: '40' },
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByLabelText('Количество')).toHaveValue(35);
  expect(screen.getByRole('alert')).toHaveTextContent('не сохранено');
});
