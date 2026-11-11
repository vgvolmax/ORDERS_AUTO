import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/app/initialState';
import { createProposal } from '../../src/app/rebalanceActions';
import { derive } from '../../src/app/selectors';
import { createWorkspaceSession, stateFromWorkspace } from '../../src/app/workspaceSession';
import { applySupplierAssignmentChange } from '../../src/domain/supplierAssignments';
import { loadSupplierCatalog } from '../../src/persistence/supplierCatalog';
import {
  listWorkspaces,
  loadActiveWorkspace,
  loadWorkspace,
  saveWorkspace,
} from '../../src/persistence/workspaces';
import { parseMinMaxWorkbook } from '../../src/import/minMaxParser';
import { parseSupplierWorkbook } from '../../src/import/supplierParser';
import { buildMinMaxFixture, buildSupplierFixture } from '../fixtures/workbookBuilders';

const primary = 'ИП Баранов Роман Борисович';
const alternative = 'ИП Никишин Андрей Николаевич';
const minMax = () => parseMinMaxWorkbook(buildMinMaxFixture()).data!;
const suppliers = () => parseSupplierWorkbook(buildSupplierFixture()).data!;
const noop = () => undefined;

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

it.each(['suppliers', 'minMax'] as const)('seeds durable links once with %s imported first', async (first) => {
  const session = createWorkspaceSession({
    initial: createInitialState(), save: saveWorkspace, publish: noop,
  });
  const reports = { minMax: minMax(), suppliers: suppliers() };
  const second = first === 'suppliers' ? 'minMax' : 'suppliers';
  await session.commit({ [first]: reports[first] });
  expect(session.getState().supplierAssignments).toBeUndefined();
  await session.commit({ [second]: reports[second] });

  const stored = (await loadActiveWorkspace())!;
  expect(stored.data.supplierAssignments).toEqual([
    { skuCode: 'SKU1', primary, additional: [] },
    { skuCode: 'SKU2', primary: alternative, additional: [] },
  ]);
  const reloaded = stateFromWorkspace(stored);
  expect(derive(reloaded).projection.orders[0]?.lines[0]).toMatchObject({
    supplier: primary, unitPrice: 100, priceSource: 'MIN_MAX',
  });
});

it('finishes setup even when the supplier report has no names in the pool', async () => {
  const session = createWorkspaceSession({
    initial: createInitialState(), save: saveWorkspace, publish: noop,
  });
  const source = suppliers();
  source.history = source.history.map((row) => ({ ...row, supplier: 'Вне пула' }));
  await session.commit({ minMax: minMax(), suppliers: source });
  const initialized = await loadActiveWorkspace();
  expect(initialized?.data.supplierAssignments).toEqual([]);
  expect(derive(session.getState()).projection.unassigned).toHaveLength(2);

  await session.commit({ suppliers: suppliers() });
  expect(await loadActiveWorkspace()).toEqual(initialized);
});

it('replaces a provisional MIN/MAX without archiving the unfinished setup', async () => {
  const session = createWorkspaceSession({
    initial: createInitialState(), save: saveWorkspace, publish: noop,
  });
  await session.commit({ minMax: minMax(), minMaxFileName: 'provisional.xlsx' });
  const firstId = session.getState().workspaceId;
  await session.commit({ minMax: minMax(), minMaxFileName: 'corrected.xlsx' });
  await session.commit({ suppliers: suppliers() });

  expect(session.getState().workspaceId).toBe(firstId);
  expect(await listWorkspaces()).toMatchObject([
    { workspaceId: firstId, minMaxFileName: 'corrected.xlsx' },
  ]);
});

it('leaves the active workspace untouched when weekly replacement fails and archives it on retry', async () => {
  const session = createWorkspaceSession({
    initial: createInitialState(), save: saveWorkspace, publish: noop,
  });
  await session.commit({ minMax: minMax(), suppliers: suppliers() });
  await session.commit((state) => ({
    supplierAssignments: applySupplierAssignmentChange(state.supplierAssignments!, {
      kind: 'set-primary', skuCodes: ['SKU1'], supplier: null,
    }),
    edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 1 }],
  }));
  const previous = session.getState();
  const archive = await loadActiveWorkspace();
  const weekly = minMax();
  const sku = weekly.skus[0]!;
  weekly.skus = [{ ...sku, code: 'NEW' }];
  weekly.branchStocks = [{ ...weekly.branchStocks[0]!, skuCode: 'NEW' }];
  const missingFile = { fileId: 'missing', name: 'weekly.xlsx', size: 1, type: '', lastModified: 1 };
  await expect(session.commit({
    minMax: weekly,
    rawImports: { ...previous.rawImports, minMax: missingFile },
  })).rejects.toThrow('WORKSPACE_FILE_MISSING');
  expect(session.getState()).toBe(previous);
  expect(await loadActiveWorkspace()).toEqual(archive);

  await session.commit({ minMax: weekly });
  expect(await loadWorkspace(previous.workspaceId)).toEqual(archive);
  expect(session.getState()).toMatchObject({
    edits: [], supplierAssignments: previous.supplierAssignments,
  });
  expect(derive(session.getState()).projection.unassigned[0]?.demand.skuCode).toBe('NEW');

  await session.commit({ minMax: minMax() });
  expect(derive(session.getState()).projection.unassigned.map(({ demand }) => demand.skuCode))
    .toContain('SKU1');
  expect(session.getState().supplierAssignments).toEqual(previous.supplierAssignments);
});

it('preserves quantity edits and invalidates only changed order markers on primary changes', async () => {
  const unaffectedSupplier = 'ООО "Терем"';
  const dataset = minMax();
  const source = suppliers();
  const sku = dataset.skus[0]!;
  const history = source.history[0]!;
  dataset.skus.push({ ...sku, code: 'NEIGHBOR' }, { ...sku, code: 'UNAFFECTED' });
  dataset.branches.push('Псков', 'Омск');
  dataset.branchStocks.push(
    { skuCode: 'NEIGHBOR', branch: 'Псков', stock: 0, min: 1, max: 2 },
    { skuCode: 'UNAFFECTED', branch: 'Омск', stock: 0, min: 1, max: 10 },
  );
  source.history.push(
    { ...history, skuCode: 'NEIGHBOR' },
    { ...history, skuCode: 'UNAFFECTED', supplier: unaffectedSupplier },
  );
  const session = createWorkspaceSession({
    initial: createInitialState({
      settings: { minimumOrderAmount: 500, thresholdMode: 'SUPPLIER_TOTAL' },
    }),
    save: saveWorkspace,
    publish: noop,
  });
  await session.commit({ minMax: dataset, suppliers: source });
  const orderIds = derive(session.getState()).projection.orders.map(({ id }) => id);
  expect(orderIds).toHaveLength(4);
  await session.commit({ edits: [{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }] });
  await session.commit({ reviewedOrderIds: orderIds, exportedOrderIds: orderIds });
  await session.commit((state) => ({
    supplierAssignments: applySupplierAssignmentChange(state.supplierAssignments!, {
      kind: 'add-additional', skuCode: 'SKU1', supplier: alternative,
    }),
  }));
  expect(session.getState().reviewedOrderIds).toEqual(orderIds);
  expect(session.getState().exportedOrderIds).toEqual(orderIds);

  await session.commit((state) => ({
    supplierAssignments: applySupplierAssignmentChange(state.supplierAssignments!, {
      kind: 'set-primary', skuCodes: ['SKU1'], supplier: alternative,
    }),
  }));
  const changed = session.getState();
  const projection = derive(changed).projection;
  const unaffectedId = `Омск\0${unaffectedSupplier}`;
  expect(changed.edits).toEqual([{ skuCode: 'SKU1', branch: 'Ленина', qty: 2 }]);
  expect(changed.reviewedOrderIds).toEqual([unaffectedId]);
  expect(changed.exportedOrderIds).toEqual([unaffectedId]);
  expect(projection.orders.find((order) => order.branch === 'Псков')).toMatchObject({
    belowThreshold: true,
    reviewed: false,
  });
  expect(projection.orders[0]?.lines[0]).toMatchObject({
    supplier: alternative, orderQty: 2, unitPrice: 100,
  });
});

it('blocks a positive order when the latest MIN/MAX price is unknown despite purchase history', async () => {
  const dataset = minMax();
  dataset.skus[0]!.referencePrice = null;
  const session = createWorkspaceSession({
    initial: createInitialState(), save: saveWorkspace, publish: noop,
  });
  await session.commit({ minMax: dataset, suppliers: suppliers() });
  const order = derive(session.getState()).projection.orders[0]!;
  expect(order).toMatchObject({ status: 'BLOCKED', totalAmount: null });
  expect(order.lines[0]).toMatchObject({ unitPrice: null, priceSource: 'MISSING' });
});


it('restores participation and routes after a branch returns while respecting a manual disable', async () => {
  const report = () => {
    const dataset = minMax();
    dataset.branches = ['Ленина', 'Ступино', 'Рязань'];
    dataset.branchStocks = [
      { skuCode: 'SKU1', branch: 'Ленина', stock: 40, min: 2, max: 10 },
      { skuCode: 'SKU1', branch: 'Ступино', stock: 0, min: 2, max: 10 },
      { skuCode: 'SKU1', branch: 'Рязань', stock: 0, min: 2, max: 10 },
    ];
    return dataset;
  };
  const session = createWorkspaceSession({
    initial: createInitialState(), save: saveWorkspace, publish: noop,
  });
  await session.commit({ minMax: report(), suppliers: suppliers() });
  const [donor, returning, disabled] = session.getState().rebalance.registry;
  const routeConfig = {
    mode: 'SELECTIVE',
    pairs: [
      { branchAId: donor!.id, branchBId: returning!.id, direction: 'BOTH' },
      { branchAId: donor!.id, branchBId: disabled!.id, direction: 'BOTH' },
    ],
  } as const;
  await session.commit(({ rebalance }) => ({
    rebalance: {
      ...rebalance,
      registry: rebalance.registry.map((branch) =>
        branch.id === disabled!.id ? { ...branch, active: false } : branch,
      ),
      config: {
        ...rebalance.config,
        routeConfig: { ...routeConfig, pairs: [...routeConfig.pairs] },
      },
    },
  }));
  const transfers = [{ fromBranchId: donor!.id, toBranchId: returning!.id, qty: 10 }];
  expect(createProposal(session.getState()).transfers).toMatchObject(transfers);
  const incomplete = report();
  incomplete.branches = ['Ленина'];
  incomplete.branchStocks = incomplete.branchStocks.slice(0, 1);
  await session.commit({ minMax: incomplete });
  await session.commit({ minMax: structuredClone(incomplete) });
  const saved = stateFromWorkspace((await loadActiveWorkspace())!);
  saved.catalog = await loadSupplierCatalog();
  expect(saved.rebalance.registry.map(({ active }) => active)).toEqual([true, false, false]);
  expect(createProposal(saved).transfers).toEqual([]);

  const reopened = createWorkspaceSession({ initial: saved, save: saveWorkspace, publish: noop });
  await reopened.commit({ minMax: report() });
  const returned = reopened.getState();
  expect(returned.rebalance.registry.map(({ id, active }) => [id, active])).toEqual([
    [donor!.id, true], [returning!.id, true], [disabled!.id, false],
  ]);
  expect(returned.rebalance.config.routeConfig).toEqual(routeConfig);
  expect(createProposal(returned).transfers).toMatchObject(transfers);
});
