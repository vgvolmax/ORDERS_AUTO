import { describe, expect, it } from 'vitest';
import { buildRouteIndex } from '../../src/domain/rebalancing/routes';
import type {
  BranchRegistry,
  RouteConfig,
  RouteDirection,
} from '../../src/domain/rebalancing/types';
import {
  setBranchRoutes,
  setRouteDirection,
} from '../../src/domain/rebalancing/routeEditing';

const registry: BranchRegistry = [
  { id: 'a', name: 'А', active: true, aliases: [] },
  { id: 'b', name: 'Б', active: true, aliases: [] },
  { id: 'c', name: 'В', active: true, aliases: [] },
  { id: 'd', name: 'Г', active: false, aliases: [] },
];
const initial: RouteConfig = {
  mode: 'SELECTIVE',
  pairs: [
    { branchAId: 'a', branchBId: 'b', direction: 'BOTH' },
    { branchAId: 'd', branchBId: 'b', direction: 'B_TO_A' },
  ],
};

describe('atomic route editing', () => {
  it('replaces a reversed pair exactly once with direction relative to the selected endpoints', () => {
    const before = structuredClone(initial);
    const next = setRouteDirection(initial, registry, 'b', 'a', 'A_TO_B');
    const graph = buildRouteIndex(next, registry);
    expect(graph.outgoing.get('b')?.has('a')).toBe(true);
    expect(graph.outgoing.get('a')?.has('b')).toBe(false);
    expect(next.pairs).toHaveLength(2);
    expect(initial).toEqual(before);
    expect(next.mode).toBe('SELECTIVE');
  });

  it.each<{ direction: RouteDirection; outgoing: string[]; incoming: boolean }>(
    [
      { direction: 'A_TO_B', outgoing: ['a', 'c'], incoming: false },
      { direction: 'B_TO_A', outgoing: [], incoming: true },
      { direction: 'BOTH', outgoing: ['a', 'c'], incoming: true },
      { direction: 'BLOCKED', outgoing: [], incoming: false },
    ],
  )(
    'sets $direction relative to selected branch for every active counterpart',
    ({ direction, outgoing, incoming }) => {
      const before = structuredClone(initial);
      const next = setBranchRoutes(initial, registry, 'b', direction);
      const graph = buildRouteIndex(next, registry);
      expect([...graph.outgoing.get('b')!].sort()).toEqual(outgoing);
      expect(graph.outgoing.get('a')?.has('b')).toBe(incoming);
      expect(graph.outgoing.get('c')?.has('b')).toBe(incoming);
      expect(next.pairs).toHaveLength(3);
      expect(next.pairs).toContainEqual({
        branchAId: 'd',
        branchBId: 'b',
        direction: 'B_TO_A',
      });
      expect(next.pairs.some((pair) => pair.branchAId === pair.branchBId)).toBe(
        false,
      );
      expect(initial).toEqual(before);
    },
  );

  it('rejects unknown, inactive and diagonal endpoints without changing saved exceptions', () => {
    for (const [from, to] of [
      ['a', 'a'],
      ['unknown', 'a'],
      ['a', 'd'],
    ]) {
      expect(() =>
        setRouteDirection(initial, registry, from!, to!, 'BOTH'),
      ).toThrow('INVALID_CONFIG');
    }
    expect(() => setBranchRoutes(initial, registry, 'd', 'BLOCKED')).toThrow(
      'INVALID_CONFIG',
    );
    expect(initial.pairs).toHaveLength(2);
  });
});
