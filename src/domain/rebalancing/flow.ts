import { integerWeights } from './numbers';

export interface FlowDonor { id: string; capacity: number }
export interface FlowReceiver { id: string; minNeed: number; minDeficit: number; targetNeed: number }
export interface FlowAssignment { from: string; to: string; units: number }
interface Edge { to: number; reverse: number; capacity: number; original: number; cost: bigint }

/** Min-cost maximum flow: actual Min coverage first, total transferable quantity second. */
export function allocateFlow(donors: FlowDonor[], receivers: FlowReceiver[], allowed: ReadonlyMap<string, ReadonlySet<string>>, step: number, preferredRoutes: ReadonlySet<string> = new Set()): FlowAssignment[] {
  const source = 0, sink = donors.length + receivers.length + 1;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const edge = (from: number, to: number, capacity: number, cost = 0n): Edge => {
    const forward = { to, reverse: graph[to]!.length, capacity, original: capacity, cost };
    const backward = { to: from, reverse: graph[from]!.length, capacity: 0, original: 0, cost: -cost };
    graph[from]!.push(forward); graph[to]!.push(backward); return forward;
  };
  const transfers: Array<{ donor: FlowDonor; receiver: FlowReceiver; edge: Edge }> = [];
  donors.forEach((donor, i) => {
    edge(source, 1 + i, donor.capacity);
    const ordered = receivers.map((receiver, j) => ({ receiver, j })).sort((a, b) => {
      const preferred = Number(preferredRoutes.has(JSON.stringify([donor.id, b.receiver.id]))) - Number(preferredRoutes.has(JSON.stringify([donor.id, a.receiver.id])));
      return preferred || b.receiver.targetNeed - a.receiver.targetNeed || (a.receiver.id < b.receiver.id ? -1 : a.receiver.id > b.receiver.id ? 1 : 0);
    });
    for (const { receiver, j } of ordered) if (allowed.get(donor.id)?.has(receiver.id)) {
      transfers.push({ donor, receiver, edge: edge(1 + i, 1 + donors.length + j, Math.min(donor.capacity, receiver.targetNeed)) });
    }
  });
  const weights = integerWeights([step, ...receivers.map((r) => r.minDeficit)]), fullStepWeight = weights[0]!;
  receivers.forEach((r, j) => {
    const node = 1 + donors.length + j;
    edge(node, sink, r.minNeed, -fullStepWeight);
    // Only the remaining physical shortage counts; excess within this step is above Min.
    const remainder = weights[j + 1]! - BigInt(r.minNeed) * fullStepWeight;
    const partialStep = r.minNeed < r.targetNeed && remainder > 0n ? 1 : 0;
    if (partialStep) edge(node, sink, 1, -remainder);
    edge(node, sink, r.targetNeed - r.minNeed - partialStep);
  });
  // Successive shortest residual paths keep every fixed-volume flow optimal.
  // Full steps are sent in capacity-sized batches, never iterated one unit at a time.
  while (true) {
    const distances = Array<bigint | null>(graph.length).fill(null);
    const previous = Array<{ from: number; index: number } | null>(graph.length).fill(null);
    distances[source] = 0n;
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false;
      for (let from = 0; from < graph.length; from++) {
        const distance = distances[from];
        if (distance == null) continue;
        graph[from]!.forEach((e, index) => {
          if (e.capacity <= 0) return;
          const candidate = distance + e.cost, old = distances[e.to];
          if (old == null || candidate < old) {
            distances[e.to] = candidate; previous[e.to] = { from, index }; changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (distances[sink] === null) break;
    let units = Number.MAX_SAFE_INTEGER;
    for (let node = sink; node !== source;) {
      const link = previous[node]!, e = graph[link.from]![link.index]!;
      units = Math.min(units, e.capacity); node = link.from;
    }
    for (let node = sink; node !== source;) {
      const link = previous[node]!, e = graph[link.from]![link.index]!;
      e.capacity -= units; graph[node]![e.reverse]!.capacity += units; node = link.from;
    }
  }
  return transfers.flatMap((t) => t.edge.original > t.edge.capacity ? [{ from: t.donor.id, to: t.receiver.id, units: t.edge.original - t.edge.capacity }] : []);
}
