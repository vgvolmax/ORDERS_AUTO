import { describe, expect, it } from 'vitest';
import { buildRouteIndex } from '../../src/domain/rebalancing/routes';
import { registry } from '../fixtures/rebalanceFixtures';

describe('direct route matrix', () => {
  it('defaults to both directions but never allows the diagonal', () => {
    const graph = buildRouteIndex({ mode: 'ALL_ALLOWED', pairs: [] }, registry());
    expect([...graph.outgoing.get('D')!]).toEqual(['R']); expect([...graph.outgoing.get('R')!]).toEqual(['D']);
    expect(graph.outgoing.get('D')!.has('D')).toBe(false);
  });
  it.each(['BOTH', 'A_TO_B', 'B_TO_A', 'BLOCKED'] as const)('enforces one %s rule symmetrically, even with reversed IDs', (direction) => {
    const graph = buildRouteIndex({ mode: 'ALL_ALLOWED', pairs: [{ branchAId: 'R', branchBId: 'D', direction }] }, registry());
    expect(graph.outgoing.get('R')!.has('D')).toBe(['BOTH', 'A_TO_B'].includes(direction));
    expect(graph.outgoing.get('D')!.has('R')).toBe(['BOTH', 'B_TO_A'].includes(direction));
  });
  it('selective mode closes unconfigured pairs, ignores inactive/stale branches with diagnostics', () => {
    const branches = registry(); branches.push({ id: 'X', name: 'Склад', aliases: [], active: false });
    const graph = buildRouteIndex({ mode: 'SELECTIVE', pairs: [{ branchAId: 'D', branchBId: 'missing', direction: 'BOTH' }] }, branches);
    expect(graph.outgoing.get('D')!.size).toBe(0); expect(graph.outgoing.has('X')).toBe(false);
    expect(graph.stalePairs).toHaveLength(1);
  });
  it('rejects conflicting duplicate unordered pair settings', () => {
    expect(() => buildRouteIndex({ mode: 'ALL_ALLOWED', pairs: [
      { branchAId: 'D', branchBId: 'R', direction: 'A_TO_B' }, { branchAId: 'R', branchBId: 'D', direction: 'BOTH' },
    ] }, registry())).toThrow();
  });
});
