import { useRef, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  StoreContext,
  type AppState,
  type StatePatch,
} from '../../src/app/appStore';
import { createWorkspaceSession, stateFromWorkspace } from '../../src/app/workspaceSession';
import { derive } from '../../src/app/selectors';
import type { StoredWorkspace } from '../../src/domain/workspace';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { baseState } from './renderWithStore';

const manualSupplier = 'ООО "Терем"';
const cheapSupplier = 'ООО "Алмаз"';

function assignedState() {
  return baseState({
    supplierAssignments: [{ skuCode: 'SKU1', primary: manualSupplier, additional: [] }],
  });
}

function renderDurable(initial = assignedState()) {
  let release!: () => void;
  let reject!: (error: Error) => void;
  const firstSave = new Promise<void>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  let attempts = 0;
  let session!: ReturnType<typeof createWorkspaceSession>;
  const saved: StoredWorkspace[] = [];
  function Harness() {
    const [state, publish] = useState(initial);
    const ref = useRef<ReturnType<typeof createWorkspaceSession> | null>(null);
    if (!ref.current) {
      ref.current = createWorkspaceSession({
        initial,
        publish,
        save: async (workspace) => {
          // Ignore view preferences so the first delayed write is a supplier change.
          if (workspace.data.supplierAssignments === ref.current?.getState().supplierAssignments) return;
          if (++attempts === 1) await firstSave;
          saved.push(structuredClone(workspace));
        },
      });
    }
    session = ref.current;
    const commit = (patch: StatePatch) => session.commit(patch);
    const set = (patch: StatePatch) => {
      if (
        typeof patch !== 'function' &&
        Object.keys(patch).every((key) => key === 'toast')
      )
        session.transient(patch);
      else void commit(patch);
    };
    return (
      <StoreContext.Provider value={{ state, set, commit }}>
        <SuppliersPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  return {
    get session() {
      return session;
    },
    saved,
    get attempts() {
      return attempts;
    },
    release,
    reject,
  };
}

it('changes the primary after durable save, retains the old primary as additional and can remove either link', async () => {
  const harness = renderDurable();
  fireEvent.click(screen.getByRole('button', { name: 'Связи SKU1' }));
  const dialog = screen.getByRole('dialog');
  const select = within(dialog).getByLabelText('Основной поставщик');
  const apply = within(dialog).getByRole('button', { name: 'Сделать основным' });
  fireEvent.change(select, { target: { value: cheapSupplier } });
  fireEvent.click(apply);
  await waitFor(() => expect(harness.attempts).toBe(1));
  expect(select).toBeDisabled();
  expect(harness.session.getState().supplierAssignments?.[0]?.primary).toBe(manualSupplier);

  await act(async () => harness.reject(new Error('quota')));
  await waitFor(() => expect(apply).toBeEnabled());
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Не удалось сохранить');
  expect(select).toHaveValue(cheapSupplier);
  fireEvent.click(apply);
  await waitFor(() => expect(harness.saved).toHaveLength(1));
  expect(stateFromWorkspace(harness.saved[0]!).supplierAssignments).toEqual([
    { skuCode: 'SKU1', primary: cheapSupplier, additional: [manualSupplier] },
  ]);
  expect(derive(harness.session.getState()).projection.orders.map((order) => order.supplier))
    .toEqual([cheapSupplier, cheapSupplier]);

  const extraSelect = within(dialog).getByLabelText('Дополнительный поставщик');
  const thirdSupplier = 'ООО "Термаснаб"';
  fireEvent.change(extraSelect, { target: { value: thirdSupplier } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
  await waitFor(() => expect(harness.saved).toHaveLength(2));
  fireEvent.click(within(dialog).getByRole('button', { name: `Удалить ${manualSupplier}` }));
  await waitFor(() => expect(harness.saved).toHaveLength(3));
  expect(derive(harness.session.getState()).projection.orders.map((order) => order.supplier))
    .toEqual([cheapSupplier, cheapSupplier]);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Снять основного' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Снять основного поставщика' })).getByRole('button', { name: 'Снять' }));
  await waitFor(() => expect(harness.saved).toHaveLength(4));
  expect(stateFromWorkspace(harness.saved[3]!).supplierAssignments).toEqual([
    { skuCode: 'SKU1', primary: null, additional: [thirdSupplier] },
  ]);
  expect(derive(harness.session.getState()).projection.orders).toEqual([]);
});

it('previews only explicit bulk choices and retains the selection and supplier after a save failure', async () => {
  const state = assignedState();
  state.minMax!.skus.push({ ...state.minMax!.skus[0]!, code: 'SKU2' });
  const harness = renderDurable(state);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать SKU1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Назначить основного выбранным' }));
  const dialog = screen.getByRole('dialog', { name: 'Назначить основного выбранным' });
  const select = within(dialog).getByLabelText('Основной поставщик');
  const apply = within(dialog).getByRole('button', { name: 'Назначить' });
  fireEvent.change(select, { target: { value: cheapSupplier } });
  expect(dialog).toHaveTextContent('Выбрано товаров: 1');
  expect(dialog).toHaveTextContent('Будет заменено основных: 1');
  fireEvent.click(apply);
  await waitFor(() => expect(harness.attempts).toBe(1));
  expect(apply).toBeDisabled();
  await act(async () => harness.reject(new Error('quota')));
  await waitFor(() => expect(apply).toBeEnabled());
  expect(select).toHaveValue(cheapSupplier);
  expect(within(dialog).getByRole('alert')).toBeVisible();
  expect(harness.session.getState().supplierAssignments).toEqual(state.supplierAssignments);
  fireEvent.click(apply);
  await waitFor(() => expect(harness.saved).toHaveLength(1));
  expect(harness.session.getState().supplierAssignments).toEqual([
    { skuCode: 'SKU1', primary: cheapSupplier, additional: [manualSupplier] },
  ]);
  expect(screen.getByRole('checkbox', { name: 'Выбрать SKU1' })).not.toBeChecked();
});
