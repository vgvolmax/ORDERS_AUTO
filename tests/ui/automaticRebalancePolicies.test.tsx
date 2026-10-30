import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StoreContext } from '../../src/app/appStore';
import { derive } from '../../src/app/selectors';
import { createProposal } from '../../src/app/rebalanceActions';
import { RebalancingPage } from '../../src/features/rebalancing/RebalancingPage';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it('calculates with step one from imported units without any policy setup screen', () => {
  const state = rebalanceAppState();
  state.rebalance.policies = [];
  const d = derive(state);
  expect(d.snapshot!.snapshot.skus[0]).toMatchObject({
    quantityStep: 1,
    unit: 'шт',
  });
  expect(
    createProposal(state).transfers.reduce((n, line) => n + line.qty, 0),
  ).toBe(50);
  render(
    <StoreContext.Provider value={{ state, set: () => undefined }}>
      <RebalancingPage />
    </StoreContext.Provider>,
  );
  expect(
    screen.queryByText('Единицы и шаг перемещения'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Шаг для ненастроенных SKU'),
  ).not.toBeInTheDocument();
});

it('ignores a saved numeric unit label and saved packaging step for new integer transfers', () => {
  const state = rebalanceAppState();
  state.rebalance.policies = [{ skuCode: 'SKU1', unit: '1', quantityStep: 10 }];
  expect(derive(state).snapshot!.snapshot.skus[0]).toMatchObject({
    unit: 'шт',
    quantityStep: 1,
  });
  expect(createProposal(state).transfers.reduce((n, t) => n + t.qty, 0)).toBe(
    50,
  );
});

it('uses a neutral unit when source units are unknown or contradictory', () => {
  const state = rebalanceAppState();
  state.rebalance.policies = [];
  state.suppliers!.history[0]!.unit = null;
  expect(derive(state).snapshot!.snapshot.skus[0]).toMatchObject({
    unit: 'ед.',
    quantityStep: 1,
  });
});

it('preserves legacy fractional accepted history while preventing new non-unit-step proposals', () => {
  const state = rebalanceAppState();
  state.rebalance.policies[0]!.quantityStep = 0.5;
  state.rebalance.accepted = [
    {
      transferId: 'old',
      sourceRunId: 'old-run',
      sourceLineId: 'old-line',
      skuCode: 'SKU1',
      fromBranchId: 'b0',
      toBranchId: 'b2',
      qty: 0.5,
      snapshotId: state.snapshotId,
      acceptedAt: '2026-10-29T00:00:00Z',
      acceptedConfig: state.rebalance.config,
    },
  ];
  const d = derive(state);
  expect(
    d.purchaseDemand.find((l) => l.branch === 'Получатель')!.purchaseQty,
  ).toBe(49.5);
  const proposal = createProposal(state);
  expect(proposal.transfers).toEqual([]);
  expect(proposal.exclusions).toContainEqual(
    expect.objectContaining({
      code: 'LEGACY_QUANTITY_POLICY',
      skuCode: 'SKU1',
    }),
  );
  expect(state.rebalance.accepted[0]!.qty).toBe(0.5);
});

it.each([false, true])(
  'does not assert a unit when import reported mixed units (saved fallback=%s)',
  async (savedFallback) => {
    const { parseSupplierWorkbook } =
      await import('../../src/import/supplierParser');
    const { buildWorkbook } = await import('../fixtures/workbookBuilders');
    const state = rebalanceAppState();
    const rows: unknown[][] = [
      [
        'Контрагент',
        'Код',
        'Номенклатура',
        'Количество',
        'Стоимость',
        'Ед. изм.',
      ],
      ['ИП Баранов Роман Борисович', 'SKU1', 'Товар', 1, 100, 'шт'],
      ['ИП Баранов Роман Борисович', 'SKU1', 'Товар', 1, 100, 'кг'],
    ];
    if (!savedFallback)
      rows.push([
        'ИП Никишин Андрей Николаевич',
        'SKU1',
        'Товар',
        1,
        100,
        'шт',
      ]);
    const parsed = parseSupplierWorkbook(buildWorkbook(rows));
    state.suppliers = parsed.data!;
    state.supplierIssues = parsed.issues;
    state.rebalance.policies = savedFallback
      ? [{ skuCode: 'SKU1', unit: 'м', quantityStep: 1 }]
      : [];
    expect(derive(state).snapshot!.snapshot.skus[0]).toMatchObject({
      unit: 'ед.',
      quantityStep: 1,
    });
  },
);

it('rejects new fractional additions from a restored proposal while preserving accepted idempotency', async () => {
  const { calculateRebalance, rebalanceConfigFingerprint } =
    await import('../../src/domain/rebalancing');
  const { createRebalanceSnapshot } =
    await import('../../src/import/rebalanceSnapshot');
  const { prepareAcceptedChange } =
    await import('../../src/app/rebalanceActions');
  const state = rebalanceAppState();
  state.minMax!.branchStocks[0]!.stock = 75.5;
  state.minMax!.branchStocks[1]!.stock = 94.5;
  state.rebalance.policies[0]!.quantityStep = 0.5;
  const old = createRebalanceSnapshot({
    snapshotId: state.snapshotId,
    dataset: state.minMax!,
    branchRegistry: state.rebalance.registry,
    skuPolicies: state.rebalance.policies,
  });
  const result = calculateRebalance(old.snapshot, state.rebalance.config, []);
  state.rebalance.proposal = {
    ...result,
    runId: 'old-run',
    createdAt: '2026-10-29T00:00:00Z',
    snapshotId: state.snapshotId,
    baseAcceptedRevision: 0,
    configFingerprint: rebalanceConfigFingerprint(state.rebalance.config),
    config: state.rebalance.config,
  };
  const first = result.transfers.find((t) => t.fromBranchId === 'b0')!;
  const next = result.transfers.find((t) => t.fromBranchId === 'b1')!;
  expect([first.qty, next.qty]).toEqual([15.5, 34.5]);
  state.rebalance.accepted = [
    {
      ...first,
      transferId: 'old-accepted',
      sourceRunId: 'old-run',
      snapshotId: state.snapshotId,
      acceptedAt: '2026-10-29T00:00:00Z',
      acceptedConfig: state.rebalance.config,
    },
  ];
  state.rebalance.acceptedRevision = 1;
  expect(() =>
    prepareAcceptedChange(state, {
      kind: 'accept',
      ids: [next.sourceLineId],
      expectedRevision: 1,
    }),
  ).toThrow('STALE_PROPOSAL');
  expect(
    prepareAcceptedChange(state, {
      kind: 'accept',
      ids: [first.sourceLineId],
      expectedRevision: 1,
    }).patch,
  ).toEqual({});
  state.rebalance.tab = 'results';
  render(
    <StoreContext.Provider value={{ state, set: () => undefined }}>
      <RebalancingPage />
    </StoreContext.Provider>,
  );
  expect(
    screen.getByText(/Предложения устарели после изменения условий/),
  ).toBeVisible();
});
