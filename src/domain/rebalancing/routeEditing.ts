import { routePairKey, routeRules } from './constraints';
import {
  RebalanceError,
  type BranchRegistry,
  type RouteConfig,
  type RouteDirection,
} from './types';

function assertActiveBranch(registry: BranchRegistry, id: string): void {
  const matches = registry.filter((branch) => branch.id === id);
  if (!id || matches.length !== 1 || !matches[0]!.active)
    throw new RebalanceError('INVALID_CONFIG');
}
function assertDirection(config: RouteConfig, direction: RouteDirection): void {
  if (
    !['ALL_ALLOWED', 'SELECTIVE'].includes(config.mode) ||
    !['BOTH', 'A_TO_B', 'B_TO_A', 'BLOCKED'].includes(direction)
  )
    throw new RebalanceError('INVALID_CONFIG');
  routeRules({ routeConfig: config });
}
/** The direction is relative to a → b, including when the stored pair is reversed. */
export function setRouteDirection(
  config: RouteConfig,
  registry: BranchRegistry,
  a: string,
  b: string,
  direction: RouteDirection,
): RouteConfig {
  assertDirection(config, direction);
  assertActiveBranch(registry, a);
  assertActiveBranch(registry, b);
  if (a === b) throw new RebalanceError('INVALID_CONFIG');
  const key = routePairKey(a, b);
  return {
    ...config,
    pairs: [
      ...config.pairs.filter(
        (pair) => routePairKey(pair.branchAId, pair.branchBId) !== key,
      ),
      { branchAId: a, branchBId: b, direction },
    ],
  };
}
/** The selected branch is endpoint A, regardless of the matrix axis/page. */
export function setBranchRoutes(
  config: RouteConfig,
  registry: BranchRegistry,
  branchId: string,
  direction: RouteDirection,
): RouteConfig {
  assertDirection(config, direction);
  assertActiveBranch(registry, branchId);
  return registry
    .filter((branch) => branch.active && branch.id !== branchId)
    .reduce(
      (next, branch) =>
        setRouteDirection(next, registry, branchId, branch.id, direction),
      config,
    );
}
