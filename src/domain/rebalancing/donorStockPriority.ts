import {
  allocateFlow,
  type FlowAssignment,
  type FlowDonor,
  type FlowReceiver,
} from './flow';
import { integerWeights, quantityFromUnits } from './numbers';

export interface StockDonor extends FlowDonor {
  stock: number;
  max: number;
  minimumUnits: number;
}

type Routes = ReadonlyMap<string, ReadonlySet<string>>;
interface CandidateRoute {
  donor: number;
  minimum: number;
}

export function eligibleDonorRoutes(
  donors: StockDonor[],
  receiver: FlowReceiver,
  allowed: Routes,
): CandidateRoute[] {
  return donors.flatMap((d, donor) =>
    allowed.get(d.id)?.has(receiver.id) &&
    Math.min(d.capacity, receiver.targetNeed) >= d.minimumUnits
      ? [{ donor, minimum: d.minimumUnits }]
      : [],
  );
}

// A bounded deterministic search returns its best legal plan and flags incomplete optimization.
const MAX_STATES_PER_SKU = 4_000;
export const MAX_STATES_PER_CALCULATION = 30_000;

interface Choice {
  receiver: FlowReceiver;
  full: boolean;
  routes: CandidateRoute[];
  reserved: number;
}
interface Plan {
  lines: FlowAssignment[];
  full: number;
  units: number;
  reserve: bigint;
  donorsUsed: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Compare the mean remaining stock / Max of the donors used by a tied plan. */
function reserveScale(donors: StockDonor[], step: number) {
  const [unit, ...values] = integerWeights([
    step,
    ...donors.map((d) => d.stock),
    ...donors.map((d) => d.max),
  ]);
  const stocks = values.slice(0, donors.length);
  const maxes = values.slice(donors.length);
  const positive = maxes.filter((m) => m > 0n);
  const common = positive.reduce((a, b) => a / gcd(a, b) * b, 1n);
  const largestStock = stocks.reduce((a, b) => a > b ? a : b, 0n);
  const smallestMax = positive.reduce((a, b) => a < b ? a : b, common);
  // Positive stock at Max=0 ranks above any finite ratio; zero stock scores zero.
  const zeroMaxWeight = common / smallestMax * (largestStock + 1n);
  return {
    stocks, unit: unit!,
    costs: new Map(donors.map((d, i) => [
      d.id, maxes[i] === 0n ? zeroMaxWeight : common / maxes[i]!,
    ])),
  };
}

export function prioritizeDonorStock(
  donors: StockDonor[],
  receivers: FlowReceiver[],
  allowed: Routes,
  step: number,
  preferred: ReadonlySet<string>,
  physicalFlow: FlowAssignment[],
  budget = { remaining: MAX_STATES_PER_CALCULATION },
): { lines: FlowAssignment[]; limited: boolean } {
  const donorIndex = new Map(donors.map((d, i) => [d.id, i]));
  const legalSeed = physicalFlow.filter((line) =>
    line.units >= donors[donorIndex.get(line.from)!]!.minimumUnits,
  );
  const targets = receivers.map((receiver) => ({
    receiver, routes: eligibleDonorRoutes(donors, receiver, allowed),
  })).filter((target) => target.routes.length > 0);
  if (!targets.length || donors.length < 2)
    return { lines: legalSeed, limited: false };

  // If the whole demand fits on one route, every feasible two-route plan loses.
  if (targets.length === 1) {
    const { receiver, routes } = targets[0]!;
    if (routes.length === 1 || routes.some(({ donor }) => donors[donor]!.capacity >= receiver.targetNeed)) {
      const eligible = routes.map(({ donor }) => donors[donor]!);
      const rank = reserveScale(eligible, step);
      const ranked = eligible.map((d, i) => {
        const units = Math.min(d.capacity, receiver.targetNeed);
        return { d, units, reserve: (rank.stocks[i]! - BigInt(units) * rank.unit) * rank.costs.get(d.id)! };
      }).sort((a, b) => b.units - a.units || (a.reserve > b.reserve ? -1 : a.reserve < b.reserve ? 1 : 0));
      const best = ranked[0]!;
      return { lines: [{ from: best.d.id, to: receiver.id, units: best.units }], limited: false };
    }
  }

  const rank = reserveScale(donors, step);
  const caps = donors.map((d) => d.capacity);
  const choices: Choice[] = [];
  const visited = new Set<string>();
  let states = Math.min(MAX_STATES_PER_SKU, budget.remaining);
  const initialStates = states;
  let limited = false;

  function measure(lines: FlowAssignment[]): Plan {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    let units = 0;
    for (const line of lines) {
      incoming.set(line.to, (incoming.get(line.to) ?? 0) + line.units);
      outgoing.set(line.from, (outgoing.get(line.from) ?? 0) + line.units);
      units += line.units;
    }
    let reserve = 0n;
    for (const [id, moved] of outgoing) {
      const stock = rank.stocks[donorIndex.get(id)!]!;
      reserve += (stock - BigInt(moved) * rank.unit) * rank.costs.get(id)!;
    }
    return {
      lines, units, reserve, donorsUsed: BigInt(outgoing.size),
      full: targets.filter(({ receiver }) => incoming.get(receiver.id) === receiver.targetNeed).length,
    };
  }

  let best = measure(legalSeed);
  function consider(lines: FlowAssignment[]): void {
    const plan = measure(lines);
    const order = plan.full - best.full || plan.units - best.units ||
      best.lines.length - plan.lines.length;
    if (order > 0 || (order === 0 &&
      plan.reserve * best.donorsUsed > best.reserve * plan.donorsUsed))
      best = plan;
  }

  function spend(): boolean {
    if (states <= 0) {
      limited = true;
      return false;
    }
    states--;
    return true;
  }

  function finish(): void {
    const remainingRoutes = new Map<string, Set<string>>();
    const residual: FlowReceiver[] = [];
    const lines: FlowAssignment[] = [];
    for (const { receiver, routes, full, reserved } of choices) {
      const left = receiver.targetNeed - reserved - Number(!full);
      for (const route of routes) {
        const from = donors[route.donor]!.id;
        lines.push({ from, to: receiver.id, units: route.minimum });
        if (left <= 0) continue;
        const destinations = remainingRoutes.get(from) ?? new Set<string>();
        destinations.add(receiver.id);
        remainingRoutes.set(from, destinations);
      }
      if (left > 0) residual.push({
        id: receiver.id, targetNeed: left,
        minNeed: full ? left : 0,
        minDeficit: full ? quantityFromUnits(left, step) : 0,
      });
    }
    if (!residual.length) return consider(lines);
    const flow = allocateFlow(
      donors.map((d, i) => ({ id: d.id, capacity: caps[i]! })),
      residual, remainingRoutes, step, preferred, rank.costs,
    );
    for (const target of residual) {
      if (target.minNeed > 0 && flow.filter((t) => t.to === target.id)
        .reduce((total, line) => total + line.units, 0) !== target.targetNeed)
        return;
    }
    const extra = new Map(flow.map((line) => [JSON.stringify([line.from, line.to]), line.units]));
    consider(lines.map((line) => ({
      ...line, units: line.units + (extra.get(JSON.stringify([line.from, line.to])) ?? 0),
    })));
  }

  function visit(index: number, full: number, demand: number, count: number): void {
    if (limited) return;
    const pending = choices.flatMap((choice) => {
      const left = choice.receiver.targetNeed - choice.reserved - Number(!choice.full);
      return left > 0
        ? [{ left, full: choice.full, donors: choice.routes.map((route) => route.donor) }]
        : [];
    });
    // Processed receivers are interchangeable for later feasibility when their residual demands match.
    const key = JSON.stringify([index, full, demand, count, caps, pending]);
    if (visited.has(key)) return;
    visited.add(key);
    if (!spend()) return;

    const available = caps.reduce((sum, cap) => sum + cap, 0);
    const required = pending.reduce(
      (sum, entry) => sum + (entry.full ? entry.left : 0), 0,
    );
    if (required > available) return;
    const future = targets.slice(index);
    const fullNeeds = future.filter(({ receiver, routes }) =>
      routes.reduce((sum, { donor, minimum }) =>
        sum + (caps[donor]! >= minimum ? caps[donor]! : 0), 0) >= receiver.targetNeed,
    ).map(({ receiver }) => receiver.targetNeed).sort((a, b) => a - b);
    let fullUpper = full;
    let remaining = available - required;
    for (const need of fullNeeds) {
      if (remaining < need) break;
      remaining -= need;
      fullUpper++;
    }
    const reserved = donors.reduce((sum, donor, i) => sum + donor.capacity - caps[i]!, 0);
    const volumeUpper = Math.min(
      reserved + available,
      demand + future.reduce((sum, { receiver }) => sum + receiver.targetNeed, 0),
    );
    if (fullUpper < best.full || (fullUpper === best.full && (
      volumeUpper < best.units ||
      (volumeUpper === best.units && count + fullUpper - full > best.lines.length)
    ))) return;

    const next = targets[index];
    if (!next) return finish();
    const { receiver, routes } = next;

    function choose(bundle: CandidateRoute[], fullChoice: boolean, minimum: number): void {
      const max = fullChoice ? receiver.targetNeed : receiver.targetNeed - 1;
      const capacity = bundle.reduce((sum, route) => sum + caps[route.donor]!, 0);
      if (minimum > max || (fullChoice && capacity < max)) return;
      const chosen = fullChoice && bundle.length === 1
        ? [{ donor: bundle[0]!.donor, minimum: max }]
        : bundle;
      const reservedUnits = fullChoice && bundle.length === 1 ? max : minimum;
      for (const route of chosen) caps[route.donor]! -= route.minimum;
      choices.push({ receiver, full: fullChoice, routes: chosen, reserved: reservedUnits });
      visit(index + 1, full + Number(fullChoice), demand + max, count + chosen.length);
      choices.pop();
      for (const route of chosen) caps[route.donor]! += route.minimum;
    }

    function combinations(bundle: CandidateRoute[], start: number, minimum: number, fullChoice: boolean): void {
      const max = fullChoice ? receiver.targetNeed : receiver.targetNeed - 1;
      for (let i = start; i < routes.length && !limited; i++) {
        const route = routes[i]!;
        const nextMinimum = minimum + route.minimum;
        if (caps[route.donor]! < route.minimum || nextMinimum > max) continue;
        bundle.push(route);
        if (bundle.length > 1) {
          if (!spend()) return;
          choose([...bundle], fullChoice, nextMinimum);
        }
        if (nextMinimum < max) combinations(bundle, i + 1, nextMinimum, fullChoice);
        bundle.pop();
      }
    }

    for (const fullChoice of [true, false]) {
      for (const route of routes) {
        if (limited) break;
        if (caps[route.donor]! >= route.minimum) choose([route], fullChoice, route.minimum);
      }
      combinations([], 0, 0, fullChoice);
    }
    visit(index + 1, full, demand, count);
  }

  visit(0, 0, 0, 0);
  budget.remaining -= initialStates - states;
  return { lines: best.lines, limited };
}
