import {
  allocateFlow,
  type FlowAssignment,
  type FlowDonor,
  type FlowReceiver,
} from './flow';
import { integerWeights, quantityFromUnits, subtractQuantity } from './numbers';

export interface StockDonor extends FlowDonor {
  stock: number;
  max: number;
  minimumUnits: number;
}

type Routes = ReadonlyMap<string, ReadonlySet<string>>;

function isComplete(flow: FlowAssignment[], receivers: FlowReceiver[]): boolean {
  return (
    flow.reduce((sum, line) => sum + line.units, 0) ===
    receivers.reduce((sum, receiver) => sum + receiver.targetNeed, 0)
  );
}

function mergeRouteQuantities(flow: FlowAssignment[]): FlowAssignment[] {
  const lines = new Map<string, FlowAssignment>();
  for (const line of flow) {
    const key = JSON.stringify([line.from, line.to]);
    const existing = lines.get(key);
    lines.set(key, { ...line, units: line.units + (existing?.units ?? 0) });
  }
  return [...lines.values()];
}

/** A route either ships nothing or ships at least its monetary minimum. */
function findCompleteMonetaryFlow(
  donors: StockDonor[],
  receivers: FlowReceiver[],
  allowed: Routes,
  step: number,
  preferred: ReadonlySet<string>,
): FlowAssignment[] | null {
  const minimums = new Map(donors.map((d) => [d.id, d.minimumUnits]));
  const eligible = new Map(donors.map((d) => {
    const destinations = receivers.filter((r) =>
      allowed.get(d.id)?.has(r.id) &&
      Math.min(d.capacity, r.targetNeed) >= d.minimumUnits,
    );
    return [d.id, new Set(destinations.map((r) => r.id))];
  }));

  function search(
    remainingDonors: FlowDonor[],
    remainingReceivers: FlowReceiver[],
    routes: Routes,
    reserved: FlowAssignment[],
  ): FlowAssignment[] | null {
    const flow = allocateFlow(
      remainingDonors, remainingReceivers, routes, step, preferred,
    );
    if (!isComplete(flow, remainingReceivers)) return null;
    const small = flow.find(({ from, to, units }) =>
      units < minimums.get(from)! &&
      !reserved.some((line) => line.from === from && line.to === to),
    );
    if (!small)
      return reserved.length ? mergeRouteQuantities([...reserved, ...flow]) : flow;

    const { from, to } = small;
    const without = new Map(routes);
    const destinations = new Set(without.get(from));
    destinations.delete(to);
    without.set(from, destinations);
    const alternative = search(
      remainingDonors, remainingReceivers, without, reserved,
    );
    if (alternative) return alternative;

    const units = minimums.get(from)!;
    const donor = remainingDonors.find((d) => d.id === from)!;
    const receiver = remainingReceivers.find((r) => r.id === to)!;
    if (units > Math.min(donor.capacity, receiver.targetNeed)) return null;
    const qty = quantityFromUnits(units, step);
    return search(
      remainingDonors.map((d) =>
        d === donor ? { ...d, capacity: d.capacity - units } : d,
      ),
      remainingReceivers.map((r) => r === receiver
        ? {
            ...r,
            minNeed: Math.max(0, r.minNeed - units),
            minDeficit: Math.max(0, subtractQuantity(r.minDeficit, qty)),
            targetNeed: r.targetNeed - units,
          }
        : r,
      ),
      routes,
      [...reserved, { from, to, units }],
    );
  }
  return search(donors, receivers, eligible, []);
}

function compareReserve(
  a: { stock: number; max: number },
  b: { stock: number; max: number },
): number {
  // Positive stock against Max=0 ranks first; 0/0 ranks as zero remaining stock.
  const [aStock, aMax, bStock, bMax] = integerWeights([
    a.stock, a.stock === 0 && a.max === 0 ? 1 : a.max,
    b.stock, b.stock === 0 && b.max === 0 ? 1 : b.max,
  ]) as [bigint, bigint, bigint, bigint];
  const difference = bStock * aMax - aStock * bMax;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Prefer one donor per recipient without giving up an available complete plan. */
export function prioritizeDonorStock(
  donors: StockDonor[],
  receivers: FlowReceiver[],
  allowed: Routes,
  step: number,
  preferred: ReadonlySet<string>,
  physicalFlow: FlowAssignment[],
): FlowAssignment[] {
  if (donors.length < 2 || !receivers.length) return physicalFlow;
  const minimums = new Map(donors.map((d) => [d.id, d.minimumUnits]));
  const monetaryFlow = physicalFlow.every(
    (line) => line.units >= minimums.get(line.from)!,
  )
    ? physicalFlow
    : findCompleteMonetaryFlow(donors, receivers, allowed, step, preferred);
  let remainingDonors = donors;
  let remainingReceivers = receivers;
  let remainingFlow = monetaryFlow ?? physicalFlow;
  const assignments: FlowAssignment[] = [];

  for (const receiver of receivers) {
    const qty = quantityFromUnits(receiver.targetNeed, step);
    const candidates = remainingDonors
      .filter((d) =>
        d.capacity >= receiver.targetNeed &&
        d.minimumUnits <= receiver.targetNeed &&
        allowed.get(d.id)?.has(receiver.id),
      )
      .map((donor) => ({
        donor, stock: subtractQuantity(donor.stock, qty), max: donor.max,
      }))
      .sort(compareReserve);
    const nextReceivers = remainingReceivers.filter((r) => r !== receiver);
    for (const candidate of candidates) {
      const { donor, stock } = candidate;
      const nextDonors = remainingDonors.map((d) => d === donor
        ? { ...d, stock, capacity: d.capacity - receiver.targetNeed }
        : d,
      );
      const alreadyAssigned = remainingFlow.some((line) =>
        line.from === donor.id && line.to === receiver.id &&
        line.units === receiver.targetNeed,
      );
      const nextFlow = alreadyAssigned
        ? remainingFlow.filter((line) => line.to !== receiver.id)
        : monetaryFlow
          ? findCompleteMonetaryFlow(nextDonors, nextReceivers, allowed, step, preferred)
          : allocateFlow(nextDonors, nextReceivers, allowed, step, preferred);
      if (!nextFlow || !isComplete(nextFlow, nextReceivers)) continue;
      assignments.push({ from: donor.id, to: receiver.id, units: receiver.targetNeed });
      remainingDonors = nextDonors;
      remainingReceivers = nextReceivers;
      remainingFlow = nextFlow;
      break;
    }
  }
  return [...assignments, ...remainingFlow];
}
