import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Dialog } from '../../src/components/Dialog';
it('traps keyboard focus, isolates background, cancels with Escape and returns focus', () => {
  function Example() {
    const [open, set] = useState(false);
    return (
      <>
        <button onClick={() => set(true)}>Открыть</button>
        {open && (
          <Dialog
            title="Подтверждение"
            onClose={() => set(false)}
            actions={<button>Подтвердить</button>}
          >
            <input aria-label="Поле" />
          </Dialog>
        )}
      </>
    );
  }
  const { container } = render(<Example />);
  container.inert = false;
  const trigger = screen.getByRole('button', { name: 'Открыть' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(container.inert).toBe(true);
  const first = within(dialog).getByRole('button', { name: 'Закрыть окно' }),
    last = within(dialog).getByRole('button', { name: 'Подтвердить' });
  expect(first).toHaveFocus();
  last.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(container.inert).toBe(false);
});
