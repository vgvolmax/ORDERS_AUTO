import { expect, it } from 'vitest';
import { createInitialState } from '../../src/app/initialState';
import {
  stateFromWorkspace,
  workspaceFromState,
} from '../../src/app/workspaceSession';
import { rebalanceAppState } from '../fixtures/rebalanceAppState';

it('normalizes the retired priorities tab on load without discarding historical movements or proposal', () => {
  const old = rebalanceAppState();
  old.rebalance.tab = 'priorities';
  old.rebalance.selectedLineIds = ['historical-selected'];
  const stored = workspaceFromState(old);
  const restored = stateFromWorkspace(stored);
  expect(restored.rebalance.tab).toBe('routes');
  expect(restored.rebalance.selectedLineIds).toEqual(['historical-selected']);
  expect(restored.rebalance.accepted).toEqual(old.rebalance.accepted);
  expect(stored.data.rebalance.tab).toBe('priorities');
  expect(createInitialState({ rebalance: old.rebalance }).rebalance.tab).toBe(
    'routes',
  );
});

it('preserves an operators disabled branch across a new import while activating a newly discovered branch', async () => {
  const { reconcileRegistry } = await import('../../src/app/initialState');
  const registry = [
    { id: 'old', name: 'Раменское', active: false, aliases: [] },
  ];
  const result = reconcileRegistry(
    registry,
    ['Раменское', 'Ступино'],
    () => 'new',
  );
  expect(result).toEqual([
    { id: 'old', name: 'Раменское', active: false, aliases: [] },
    { id: 'new', name: 'Ступино', active: true, aliases: [] },
  ]);
  expect(registry[0]!.active).toBe(false);
});

it('does not leave absent old branches active after replacement', async () => {
  const { reconcileRegistry } = await import('../../src/app/initialState');
  const registry = [
    { id: 'old', name: 'Исчезнувшее', active: true, aliases: [] },
  ];
  expect(reconcileRegistry(registry, [], () => 'new')[0]!.active).toBe(false);
});
