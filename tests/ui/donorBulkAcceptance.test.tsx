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
import { workspaceFromState } from '../../src/app/workspaceSession';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import {
  createProposal,
  prepareDonorPlanChange,
} from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

function initial(two = false) {
  const s = rebalanceAppState();
  s.minMax!.branchStocks.forEach((r, i) =>
    Object.assign(r, { stock: [66, 0, 0][i], min: 1, max: [60, 4, 8][i] }),
  );
  if (two) {
    s.minMax!.skus.push({ ...s.minMax!.skus[0]!, code: 'SKU2' });
    s.minMax!.branchStocks.push(
      ...s.minMax!.branchStocks.map((r) => ({ ...r, skuCode: 'SKU2' })),
    );
    s.rebalance.policies.push({ skuCode: 'SKU2', unit: 'шт', quantityStep: 1 });
  }
  s.rebalance.proposal = createProposal(s);
  s.rebalance.tab = 'priorities';
  return s;
}
function harness(start: AppState, save: () => Promise<void> = async () => {}) {
  let session!: ReturnType<typeof createWorkspaceSession>;
  function Harness() {
    const [state, publish] = useState(start),
      [pending, setPending] = useState(0),
      ref = useRef<ReturnType<typeof createWorkspaceSession> | null>(null);
    if (!ref.current)
      ref.current = createWorkspaceSession({ initial: start, publish, save });
    session = ref.current;
    const commit = async (patch: StatePatch) => {
      setPending((n) => n + 1);
      try {
        await session.commit(patch);
      } finally {
        setPending((n) => n - 1);
      }
    };
    return (
      <StoreContext.Provider
        value={{
          state,
          saving: pending > 0,
          commit,
          set: (p) => {
            void commit(p).catch(() => undefined);
          },
        }}
      >
        <RebalancingPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Приоритеты Донор А' }));
  return Object.assign(() => session.getState(), {
    restore: (state: AppState) => session.restore(workspaceFromState(state)),
  });
}
function preconfigured(two = false) {
  const s = initial(two);
  return {
    ...s,
    ...prepareDonorPlanChange(
      s,
      {
        kind: 'levels',
        fromBranchId: 'b0',
        levels: [['b2'], ['b1'], []],
        overwriteManual: false,
      },
      { runId: s.rebalance.proposal!.runId, acceptedRevision: 0 },
    ),
  };
}
it('applies, moves and removes divisions atomically; cancel leaves committed levels alone', async () => {
  const get = harness(initial());
  fireEvent.click(
    screen.getByRole('button', { name: 'Настроить приоритет 1' }),
  );
  let dialog = screen.getByRole('dialog', {
    name: 'Подразделения приоритета 1',
  });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Получатель' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  expect(get().rebalance.proposal!.allocationPriorityLevels).toBeUndefined();
  fireEvent.click(
    screen.getByRole('button', { name: 'Настроить приоритет 2' }),
  );
  dialog = screen.getByRole('dialog', { name: 'Подразделения приоритета 2' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Получатель' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
  await waitFor(() =>
    expect(get().rebalance.proposal!.allocationPriorityLevels?.b0).toEqual([
      [],
      ['b2'],
      [],
    ]),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Настроить приоритет 1' }),
  );
  dialog = screen.getByRole('dialog', { name: 'Подразделения приоритета 1' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Получатель' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
  await waitFor(() =>
    expect(get().rebalance.proposal!.allocationPriorityLevels?.b0).toEqual([
      ['b2'],
      [],
      [],
    ]),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Убрать Получатель из приоритета 1' }),
  );
  await waitFor(() =>
    expect(get().rebalance.proposal!.allocationPriorityLevels?.b0).toEqual([
      [],
      [],
      [],
    ]),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Настроить приоритет 1' }),
    ).toHaveFocus(),
  );
});
it('accepts the entire group despite no search results, preserves unrelated selection and keeps orders unchanged until confirm', async () => {
  const s = preconfigured(true);
  const unrelated = JSON.stringify(['SKU1', 'b0', 'b1']);
  s.rebalance.selectedLineIds = [unrelated];
  const before = derive(s).purchaseDemand,
    get = harness(s);
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск товара' }), {
    target: { value: 'нет такого' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (2)' }),
  );
  let dialog = await screen.findByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  expect(dialog).toHaveTextContent('SKU: 2');
  expect(get().rebalance.accepted).toEqual([]);
  expect(derive(get()).purchaseDemand).toEqual(before);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  expect(get().rebalance.accepted).toEqual([]);
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (2)' }),
  );
  dialog = await screen.findByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() => expect(get().rebalance.accepted).toHaveLength(2));
  expect(get().rebalance.selectedLineIds).toEqual([unrelated]);
  expect(derive(get()).purchaseDemand).not.toEqual(before);
  expect(
    screen.getByRole('button', { name: 'Принять приоритет 1 (0)' }),
  ).toBeDisabled();
});
it.each([false, true])(
  'waits for the pending quantity before scoped acceptance; save failure=%s',
  async (fail) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const get = harness(preconfigured(), async () => {
      if (first) {
        first = false;
        await gate;
        if (fail) throw Error('quota');
      }
    });
    fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
      target: { value: '3' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
    ).not.toBeInTheDocument();
    await act(async () => release());
    if (fail) {
      await waitFor(() =>
        expect(screen.getByText(/План не сохранён/)).toBeVisible(),
      );
      expect(get().rebalance.accepted).toEqual([]);
      expect(
        screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
      ).not.toBeInTheDocument();
    } else {
      const dialog = await screen.findByRole('dialog', {
        name: 'Принять выбранные перемещения',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Принять перемещения' }),
      );
      await waitFor(() => expect(get().rebalance.accepted[0]!.qty).toBe(3));
    }
  },
);
it('can accept the committed plan after an invalid quantity is rolled back', async () => {
  const get = harness(preconfigured());
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
    target: { value: '99' },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Переместить SKU1 Получатель')).toHaveValue(6),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() => expect(get().rebalance.accepted[0]!.qty).toBe(6));
});
it('combines coverage, scope and search; clearing search preserves coverage while reset clears all', async () => {
  const s = structuredClone(initial(true));
  s.minMax!.branchStocks.find(
    (r) => r.skuCode === 'SKU2' && r.branch === 'Получатель',
  )!.stock = 8;
  s.rebalance.proposal = createProposal(s);
  const configured = {
    ...s,
    ...prepareDonorPlanChange(
      s,
      {
        kind: 'levels',
        fromBranchId: 'b0',
        levels: [['b2'], ['b1'], []],
        overwriteManual: false,
      },
      { runId: s.rebalance.proposal.runId, acceptedRevision: 0 },
    ),
  };
  harness(configured);
  const coverage = screen.getByRole('combobox', { name: 'Покрытие до Max' });
  fireEvent.change(coverage, { target: { value: 'FULL' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article')).toHaveAccessibleName('Перемещения SKU2');
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск товара' }), {
    target: { value: 'нет' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(coverage).toHaveValue('FULL');
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Приоритет 1' })).getByRole(
      'button',
      { name: 'Показать SKU' },
    ),
  );
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  fireEvent.change(coverage, { target: { value: 'PARTIAL' } });
  expect(screen.getByRole('article')).toHaveAccessibleName('Перемещения SKU1');
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(coverage).toHaveValue('ALL');
});
it('protects manual rows in a bulk change and overwrites them only when explicitly requested', async () => {
  const s = preconfigured(),
    get = harness(s);
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
    target: { value: '2' },
  });
  await waitFor(() =>
    expect(get().rebalance.proposal!.allocationDecisions?.[0]!.mode).toBe(
      'MANUAL',
    ),
  );
  for (const overwrite of [false, true]) {
    fireEvent.click(
      screen.getByRole('button', { name: 'Настроить приоритет 1' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Подразделения приоритета 1',
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Донор Б' }));
    if (overwrite)
      fireEvent.click(
        within(dialog).getByRole('checkbox', {
          name: 'Перезаписать ручные количества (1 SKU)',
        }),
      );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Подразделения приоритета 1' }),
      ).not.toBeInTheDocument(),
    );
    expect(get().rebalance.proposal!.allocationDecisions?.[0]!.mode).toBe(
      overwrite ? 'PRIORITY' : 'MANUAL',
    );
    if (!overwrite)
      expect(screen.getByLabelText('Переместить SKU1 Получатель')).toHaveValue(
        2,
      );
  }
});
it('cancels an acceptance intent queued behind a quantity rejected before persistence', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const get = harness(preconfigured(), async () => {
    if (first) {
      first = false;
      await gate;
    }
  });
  fireEvent.change(screen.getByLabelText('Распределение между выбранными'), {
    target: { value: 'EQUAL' },
  });
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
    target: { value: '99' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
  );
  await act(async () => release());
  await waitFor(() =>
    expect(
      screen.getByText(/Правка перед принятием не сохранена/),
    ).toBeVisible(),
  );
  expect(
    screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
  ).not.toBeInTheDocument();
  expect(get().rebalance.accepted).toEqual([]);
  // A new explicit acceptance after seeing rollback is allowed.
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
  );
  expect(
    await screen.findByRole('dialog', {
      name: 'Принять выбранные перемещения',
    }),
  ).toBeVisible();
});
it('an unrelated successful mode save cannot erase a failed tier intent; retrying tiers unblocks acceptance', async () => {
  let fail = true;
  const get = harness(preconfigured(), async () => {
    if (fail) {
      fail = false;
      throw Error('quota');
    }
  });
  const edit = () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'Настроить приоритет 1' }),
    );
  edit();
  let dialog = screen.getByRole('dialog', {
    name: 'Подразделения приоритета 1',
  });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Донор Б' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
  await waitFor(() =>
    expect(within(dialog).getByRole('alert')).toHaveTextContent('quota'),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  fireEvent.change(screen.getByLabelText('Распределение между выбранными'), {
    target: { value: 'EQUAL' },
  });
  await waitFor(() =>
    expect(get().rebalance.proposal!.allocationModes?.b0).toBe('EQUAL'),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
  );
  await waitFor(() =>
    expect(screen.getByText(/План не сохранён/)).toBeVisible(),
  );
  expect(
    screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
  ).not.toBeInTheDocument();
  edit();
  dialog = screen.getByRole('dialog', { name: 'Подразделения приоритета 1' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Донор Б' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Подразделения приоритета 1' }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (2)' }),
  );
  expect(
    await screen.findByRole('dialog', {
      name: 'Принять выбранные перемещения',
    }),
  ).toBeVisible();
});

it('rejects an acceptance intent when a restored workspace replaces the same snapshot and run in the queue', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const s = preconfigured(),
    get = harness(s, async () => {
      if (first) {
        first = false;
        await gate;
      }
    });
  fireEvent.change(screen.getByLabelText('Переместить SKU1 Получатель'), {
    target: { value: '3' },
  });
  let restored!: Promise<void>;
  act(() => {
    restored = get.restore(s);
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
  );
  await act(async () => {
    release();
    await restored;
  });
  await waitFor(() =>
    expect(screen.getByText(/Условия или снимок изменились/)).toBeVisible(),
  );
  expect(
    screen.queryByRole('dialog', { name: 'Принять выбранные перемещения' }),
  ).not.toBeInTheDocument();
  expect(get().rebalance.accepted).toEqual([]);
});
it('does not commit a confirmation from a workspace replaced with the same revision, snapshot and run', async () => {
  const s = preconfigured();
  s.workspaceRevision = 0;
  const get = harness(s);
  fireEvent.click(
    screen.getByRole('button', { name: 'Принять приоритет 1 (1)' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Принять выбранные перемещения',
  });
  await act(async () => {
    await get.restore(s);
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Принять перемещения' }),
  );
  await waitFor(() =>
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Решения изменились',
    ),
  );
  expect(get().rebalance.accepted).toEqual([]);
});
