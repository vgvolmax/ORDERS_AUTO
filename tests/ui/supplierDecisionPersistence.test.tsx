import { useRef, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  StoreContext,
  type AppState,
  type StatePatch,
} from '../../src/app/appStore';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import { derive } from '../../src/app/selectors';
import type { StoredWorkspace } from '../../src/domain/workspace';
import { SuppliersPage } from '../../src/features/suppliers/SuppliersPage';
import { baseState } from './renderWithStore';

const manualSupplier = 'ООО "Терем"';
const cheapSupplier = 'ООО "Алмаз"';

function ambiguousState() {
  const state = baseState();
  state.suppliers = {
    suppliers: [manualSupplier, cheapSupplier],
    history: [manualSupplier, cheapSupplier].map((supplier, index) => ({
      ...state.suppliers!.history[0]!,
      supplier,
      weightedUnitCost: 100 - index * 40,
      purchaseAmount: 1000 - index * 400,
    })),
  };
  return state;
}

function renderDurable(initial = ambiguousState()) {
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

it('locks conflicting supplier controls while a manual choice is saving and preserves that choice', async () => {
  const harness = renderDurable();
  fireEvent.change(screen.getByRole('combobox', { name: 'Поставщик SKU1' }), {
    target: { value: manualSupplier },
  });
  await waitFor(() => expect(harness.attempts).toBe(1));
  expect(
    screen.getByRole('combobox', { name: 'Поставщик SKU1' }),
  ).toBeDisabled();
  const auto = screen.getByRole('button', { name: 'Применить автовыбор' });
  expect(auto).toBeDisabled();
  expect(
    screen.getByRole('checkbox', { name: 'Перезаписать ручные назначения' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('combobox', { name: 'Область применения' }),
  ).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Выбрать SKU1' })).toBeDisabled();
  expect(screen.getByText('Сохраняем выбор…')).toBeVisible();
  fireEvent.click(auto);
  await act(async () => harness.release());
  await waitFor(() =>
    expect(harness.session.getState().overrides[0]).toMatchObject({
      supplier: manualSupplier,
      source: 'MANUAL',
    }),
  );
  expect(
    harness.saved.filter((w) =>
      w.data.overrides.some((o) => o.source === 'AUTO'),
    ),
  ).toHaveLength(0);
  expect(
    derive(harness.session.getState()).projection.orders.every(
      (order) => order.lines[0]!.unitPrice === 100,
    ),
  ).toBe(true);
});

it.each([false, true])(
  'revalidates a queued manual choice at commit; explicit overwrite=%s',
  async (overwriteManual) => {
    const initial = ambiguousState();
    initial.uiPreferences['suppliers:overwriteManual'] = overwriteManual;
    const harness = renderDurable(initial);
    // The page still shows the previous committed snapshot while this preceding command saves.
    let preceding!: Promise<void>;
    act(() => {
      preceding = harness.session.commit({
        overrides: [
          {
            skuCode: 'SKU1',
            supplier: manualSupplier,
            source: 'MANUAL',
            updatedAt: '2026-10-22',
          },
        ],
      });
    });
    await waitFor(() => expect(harness.attempts).toBe(1));
    fireEvent.click(
      screen.getByRole('button', { name: 'Применить автовыбор' }),
    );
    await act(async () => {
      harness.release();
      await preceding;
    });
    await waitFor(() => expect(harness.saved.length).toBeGreaterThanOrEqual(2));
    expect(harness.session.getState().overrides[0]).toMatchObject({
      supplier: overwriteManual ? cheapSupplier : manualSupplier,
      source: overwriteManual ? 'AUTO' : 'MANUAL',
    });
  },
);

it('uses current historical prices when an earlier queued report replacement finishes', async () => {
  const initial = ambiguousState();
  const harness = renderDurable(initial);
  const suppliers = {
    ...initial.suppliers!,
    history: initial.suppliers!.history.map((row) =>
      row.supplier === cheapSupplier
        ? { ...row, weightedUnitCost: 120, purchaseAmount: 1200 }
        : row,
    ),
  };
  act(() => {
    void harness.session.commit({ suppliers });
  });
  await waitFor(() => expect(harness.attempts).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'Применить автовыбор' }));
  await act(async () => harness.release());
  await waitFor(() => expect(harness.saved.length).toBeGreaterThanOrEqual(2));
  expect(harness.session.getState().overrides[0]).toMatchObject({
    supplier: manualSupplier,
    source: 'AUTO',
  });
});

it('does not assign a supplier to demand that disappeared before the queued automation executes', async () => {
  const initial = ambiguousState();
  const harness = renderDurable(initial);
  act(() => {
    void harness.session.commit({
      minMax: {
        ...initial.minMax!,
        branchStocks: initial.minMax!.branchStocks.map((row) => ({
          ...row,
          stock: row.max!,
        })),
      },
    });
  });
  await waitFor(() => expect(harness.attempts).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'Применить автовыбор' }));
  await act(async () => harness.release());
  await waitFor(() => expect(harness.saved.length).toBeGreaterThanOrEqual(2));
  expect(harness.session.getState().overrides).toEqual([]);
  expect(derive(harness.session.getState()).projection.orders).toEqual([]);
});

it.each(['manual', 'auto'] as const)(
  'recovers from a failed %s save without changing the previous choice or selection, then retries',
  async (operation) => {
    const initial = ambiguousState();
    initial.uiPreferences['suppliers:selectedCodes'] = ['SKU1'];
    const harness = renderDurable(initial);
    const run = () =>
      operation === 'manual'
        ? fireEvent.change(
            screen.getByRole('combobox', { name: 'Поставщик SKU1' }),
            { target: { value: manualSupplier } },
          )
        : fireEvent.click(
            screen.getByRole('button', { name: 'Применить автовыбор' }),
          );
    run();
    await waitFor(() => expect(harness.attempts).toBe(1));
    await act(async () => harness.reject(new Error('quota')));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Применить автовыбор' }),
      ).toBeEnabled(),
    );
    expect(harness.session.getState().overrides).toEqual([]);
    expect(
      screen.getByRole('checkbox', { name: 'Выбрать SKU1' }),
    ).toBeChecked();
    expect(harness.saved).toEqual([]);
    expect(harness.session.getState().toast).toMatch(/Не удалось сохранить/);
    run();
    await waitFor(() =>
      expect(harness.session.getState().overrides[0]?.supplier).toBe(
        operation === 'manual' ? manualSupplier : cheapSupplier,
      ),
    );
  },
);
