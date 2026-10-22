import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useDurableDraft } from '../../src/app/useDurableDraft';
it('keeps typing responsive across intermediate saves and rolls back the final rejected draft', async () => {
  const pending: { resolve: () => void; reject: () => void }[] = [];
  const write = () =>
    new Promise<void>((resolve, reject) =>
      pending.push({ resolve, reject: () => reject(new Error('quota')) }),
    );
  function Field({ persisted }: { persisted: string }) {
    const [value, change] = useDurableDraft(persisted, 'workspace', write);
    return (
      <input
        aria-label="Поиск"
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    );
  }
  const view = render(<Field persisted="" />);
  fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'S' } });
  fireEvent.change(screen.getByLabelText('Поиск'), {
    target: { value: 'SKU' },
  });
  await act(async () => pending[0]!.resolve());
  view.rerender(<Field persisted="S" />);
  expect(screen.getByLabelText('Поиск')).toHaveValue('SKU');
  await act(async () => pending[1]!.reject());
  expect(screen.getByLabelText('Поиск')).toHaveValue('S');
});
