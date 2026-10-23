import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { createInitialState } from '../../src/app/initialState';
import { workspaceFromState } from '../../src/app/workspaceSession';
import {
  loadWorkspace,
  saveWorkspace,
  loadActiveWorkspace,
  listWorkspaces,
  loadWorkspaceFile,
} from '../../src/persistence/workspaces';
import { db } from '../../src/persistence/db';
import { getSettings } from '../../src/persistence/settings';
import { getSupplierOverrides } from '../../src/persistence/supplierOverrides';
import { snapshot, config } from '../fixtures/rebalanceFixtures';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';
import {
  createProposal,
  prepareDonorPlanChange,
} from '../../src/app/rebalanceActions';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
function fixture(id = 'w1', revision = 0) {
  const state = createInitialState({
    workspaceId: id,
    workspaceRevision: revision,
    snapshotId: 'snapshot-1',
  });
  state.rebalance.registry = snapshot().branches;
  state.rebalance.config = config({ receiverPct: 50 });
  state.rebalance.selectedLineIds = ['line1'];
  state.rebalance.rejectedLineIds = ['line2'];
  state.edits = [{ skuCode: '00001', branch: 'Донор', qty: 9 }];
  state.reviewedOrderIds = ['order1'];
  state.exportedOrderIds = ['order1'];
  state.uiPreferences = { demand: { query: 'товар' } };
  return workspaceFromState(state);
}
describe('complete durable purchasing workspace', () => {
  it('round trips editable priorities, mode and quantities while legacy proposals need no migration', async () => {
    let state = rebalanceAppState();
    state.workspaceId = 'donor-priorities';
    state.workspaceRevision = 0;
    state.rebalance.proposal = createProposal(state);
    const legacy = workspaceFromState(state);
    await saveWorkspace(legacy, -1);
    expect(
      (await loadActiveWorkspace())!.data.rebalance.proposal
        ?.allocationDecisions,
    ).toBeUndefined();
    const expected = {
      runId: state.rebalance.proposal.runId,
      acceptedRevision: 0,
    };
    state = {
      ...state,
      ...prepareDonorPlanChange(
        state,
        {
          kind: 'quantity',
          skuCode: 'SKU1',
          fromBranchId: 'b0',
          toBranchId: 'b2',
          qty: 10,
        },
        expected,
      ),
    };
    state = {
      ...state,
      ...prepareDonorPlanChange(
        state,
        { kind: 'mode', fromBranchId: 'b0', mode: 'EQUAL' },
        expected,
      ),
      workspaceRevision: 1,
    };
    const edited = workspaceFromState(state);
    edited.data.rebalance.tab = 'priorities';
    await saveWorkspace(edited, 0);
    expect(await loadActiveWorkspace()).toEqual(edited);
    expect(
      (await loadActiveWorkspace())!.data.rebalance.proposal
        ?.allocationDecisions?.[0]?.quantities?.b2,
    ).toBe(10);
  });
  it('upgrades v1 additively without losing existing settings or supplier mappings', async () => {
    const legacy = await openDB('orders-auto', 1, {
      upgrade(d) {
        d.createObjectStore('supplierOverrides', { keyPath: 'skuCode' });
        d.createObjectStore('settings');
      },
    });
    await legacy.put(
      'settings',
      { minimumOrderAmount: 123, thresholdMode: 'SUPPLIER_TOTAL' },
      'main',
    );
    await legacy.put('supplierOverrides', {
      skuCode: '1',
      supplier: 'S',
      updatedAt: 'today',
    });
    legacy.close();
    await saveWorkspace(fixture(), -1);
    expect((await getSettings()).minimumOrderAmount).toBe(123);
    expect((await getSupplierOverrides())[0]!.supplier).toBe('S');
    expect((await db()).version).toBe(2);
  });
  it('round trips all state and raw bytes separately and keeps old imports in history', async () => {
    const first = fixture();
    first.data.rawImports.minMax = {
      fileId: 'f1',
      name: 'input.xlsx',
      type: '',
      lastModified: 1,
      size: 3,
    };
    const file = {
      ...first.data.rawImports.minMax,
      bytes: new Uint8Array([1, 2, 3]).buffer,
    };
    await saveWorkspace(first, -1, [file]);
    expect(await loadActiveWorkspace()).toEqual(first);
    expect(
      Array.from(new Uint8Array((await loadWorkspaceFile('f1'))!.bytes)),
    ).toEqual([1, 2, 3]);
    const second = fixture('w2');
    second.previousActive = { workspaceId: 'w1', revision: 0 };
    await saveWorkspace(second, -1);
    expect(await loadWorkspace('w1')).toEqual(first);
    expect((await loadActiveWorkspace())!.workspaceId).toBe('w2');
    expect(await listWorkspaces()).toHaveLength(2);
  });
  it('rejects stale saves and stale new-import activation without overwriting either workspace', async () => {
    const first = fixture();
    await saveWorkspace(first, -1);
    const newer = fixture('w1', 1);
    newer.data.settings.minimumOrderAmount = 200;
    await saveWorkspace(newer, 0);
    await expect(saveWorkspace(fixture('w1', 1), 0)).rejects.toThrow(
      'WORKSPACE_CONFLICT',
    );
    const staleImport = fixture('w2');
    staleImport.previousActive = { workspaceId: 'w1', revision: 0 };
    await expect(saveWorkspace(staleImport, -1)).rejects.toThrow(
      'WORKSPACE_CONFLICT',
    );
    expect(await loadActiveWorkspace()).toEqual(newer);
    expect(await loadWorkspace('w2')).toBeNull();
  });
  it('rejects unsupported schema without clearing stored data', async () => {
    const future = { ...fixture(), schemaVersion: 99 };
    const d = await db();
    await d.put('workspaces', future as never);
    await d.put('workspaceMeta', { workspaceId: 'w1', revision: 0 }, 'main');
    await expect(loadActiveWorkspace()).rejects.toThrow('WORKSPACE_VERSION');
    expect(await d.get('workspaces', 'w1')).toEqual(future);
  });
  it('rolls back workspace and active pointer if a raw-file write fails', async () => {
    const first = fixture();
    await saveWorkspace(first, -1);
    const broken = fixture('w1', 1);
    await expect(
      saveWorkspace(broken, 0, [
        {
          fileId: 'bad',
          name: 'bad',
          type: '',
          lastModified: 0,
          size: 0,
          bytes: (() => 0) as unknown as ArrayBuffer,
        },
      ]),
    ).rejects.toThrow();
    expect(await loadActiveWorkspace()).toEqual(first);
    expect(await loadWorkspaceFile('bad')).toBeNull();
  });
});
