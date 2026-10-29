import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext } from '../../src/app/appStore';
import { createWorkspaceSession } from '../../src/app/workspaceSession';
import { ImportPage } from '../../src/features/import/ImportPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import { buildWorkbook } from '../fixtures/workbookBuilders';
import { createProposal } from '../../src/app/rebalanceActions';

it('preserves a wholly malformed branch known by a saved alias through the import session', async () => {
  const initial = rebalanceAppState();
  initial.rebalance.registry = [
    { id: 'R', name: 'Получатель', active: true, aliases: ['Старое имя'] },
  ];
  initial.rebalance.policies = [{ skuCode: 'S', unit: 'шт', quantityStep: 1 }];
  let session!: ReturnType<typeof createWorkspaceSession>;
  function Harness() {
    const [state, publish] = useState(initial);
    const ref = useRef<ReturnType<typeof createWorkspaceSession> | null>(null);
    if (!ref.current)
      ref.current = createWorkspaceSession({
        initial,
        publish,
        save: async () => undefined,
      });
    session = ref.current;
    return (
      <StoreContext.Provider
        value={{
          state,
          commit: session.commit,
          set: (patch) => {
            void session.commit(patch);
          },
        }}
      >
        <ImportPage />
      </StoreContext.Provider>
    );
  }
  render(<Harness />);
  const bytes = buildWorkbook([
    [
      'Код',
      'Артикул',
      'Номенклатура',
      'Количество',
      'Минимальный остаток',
      'Максимальный остаток',
      'Цена',
    ],
    ['S', 'A', 'SKU', null, null, null, 100],
    [null, null, 'Старое имя', 'broken', 'broken', 'broken', null],
  ]);
  const file = new File([bytes], 'broken.xlsx');
  fireEvent.change(screen.getByLabelText('Выбрать файл Отчёт MIN/MAX'), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(session.getState().minMaxFileName).toBe('broken.xlsx'),
  );
  expect(
    screen.getByText(/Некорректные числовые данные.*S.*Старое имя/),
  ).toBeVisible();
  const saved = session.getState();
  expect(saved.rebalance.registry).toEqual([
    { id: 'R', name: 'Получатель', active: true, aliases: ['Старое имя'] },
  ]);
  expect(saved.minMax!.skus.map((s) => s.code)).toEqual(['S']);
  expect(saved.minMax!.branchStocks).toEqual([]);
  expect(createProposal(saved).exclusions).toContainEqual(
    expect.objectContaining({
      code: 'INVALID_BRANCH_VALUES',
      skuCode: 'S',
      branchId: 'R',
    }),
  );
});
