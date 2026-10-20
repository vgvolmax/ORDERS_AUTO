export interface FlowDonor { id: string; capacity: number }
export interface FlowReceiver { id: string; minNeed: number; targetNeed: number }
export interface FlowAssignment { from: string; to: string; units: number }
interface Edge { to: number; reverse: number; capacity: number; original: number }

/** Two maximum-flow phases on ONE residual graph: reverse arcs keep early routing revisable. */
export function allocateFlow(donors: FlowDonor[], receivers: FlowReceiver[], allowed: ReadonlyMap<string, ReadonlySet<string>>, preferredRoutes: ReadonlySet<string> = new Set()): FlowAssignment[] {
  const source = 0, sink = donors.length + receivers.length + 1;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const edge = (from: number, to: number, capacity: number): Edge => {
    const forward = { to, reverse: graph[to]!.length, capacity, original: capacity };
    const backward = { to: from, reverse: graph[from]!.length, capacity: 0, original: 0 };
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
  const targets = receivers.map((r, j) => edge(1 + donors.length + j, sink, r.minNeed));
  const maxFlow = () => {
    while (true) {
      const levels = Array<number>(graph.length).fill(-1), queue = [source]; levels[source] = 0;
      for (let q = 0; q < queue.length; q++) for (const e of graph[queue[q]!]!) {
        if (e.capacity > 0 && levels[e.to] === -1) { levels[e.to] = levels[queue[q]!]! + 1; queue.push(e.to); }
      }
      if (levels[sink] === -1) return;
      const cursor = Array<number>(graph.length).fill(0);
      const send = (node: number, amount: number): number => {
        if (node === sink) return amount;
        for (; cursor[node]! < graph[node]!.length; cursor[node] = cursor[node]! + 1) {
          const e = graph[node]![cursor[node]!]!;
          if (e.capacity <= 0 || levels[e.to] !== levels[node]! + 1) continue;
          const pushed = send(e.to, Math.min(amount, e.capacity));
          if (pushed > 0) { e.capacity -= pushed; graph[e.to]![e.reverse]!.capacity += pushed; return pushed; }
        }
        return 0;
      };
      while (send(source, Number.MAX_SAFE_INTEGER) > 0) { /* exhaust this level graph */ }
    }
  };
  maxFlow();
  receivers.forEach((r, j) => { targets[j]!.capacity += r.targetNeed - r.minNeed; });
  maxFlow();
  return transfers.flatMap((t) => t.edge.original > t.edge.capacity ? [{ from: t.donor.id, to: t.receiver.id, units: t.edge.original - t.edge.capacity }] : []);
}
