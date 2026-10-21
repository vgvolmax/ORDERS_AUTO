import { routeRules, routeAllows } from './constraints';
import { RebalanceError, type RouteConfig, type RebalanceBranch, type RouteIndex } from './types';

export function buildRouteIndex(config: RouteConfig, branches: RebalanceBranch[]): RouteIndex {
  if (!['ALL_ALLOWED', 'SELECTIVE'].includes(config.mode)) throw new RebalanceError('INVALID_CONFIG');
  const rules = routeRules({ routeConfig: config });
  const active = branches.filter((b) => b.active).map((b) => b.id).sort();
  const ids = new Set(active);
  const outgoing = new Map<string, Set<string>>();
  for (const from of active) outgoing.set(from, new Set(active.filter((to) => routeAllows({ routeConfig: config }, from, to, rules))));
  const stalePairs = config.pairs.filter((p) => !ids.has(p.branchAId) || !ids.has(p.branchBId)).map((p) => ({ ...p }));
  return { outgoing, stalePairs };
}
