import { useLayoutEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext } from '../../src/app/appStore';
import { usePreference } from '../../src/app/usePreference';
import { createInitialState } from '../../src/app/initialState';

it('keeps an immediate edit while initial preference persistence is pending', () => {
  const state = createInitialState();
  function Field() {
    const [value, change] = usePreference('query', '');
    useLayoutEffect(() => {
      change('typed');
    }, []);
    return <input aria-label="Запрос" readOnly value={value} />;
  }
  render(
    <StoreContext.Provider value={{ state, set: () => undefined }}>
      <Field />
    </StoreContext.Provider>,
  );
  expect(screen.getByLabelText('Запрос')).toHaveValue('typed');
});
