import type { BuildingId, FlowCounters, FlowSnapshot, ResourceKind } from '../shared';
import { emptyFlowSnapshot, flowEdgeKey } from '../shared';
import type { SimWorld } from './world';

const counters = (snap: FlowSnapshot, b: BuildingId): FlowCounters =>
  (snap.byBuilding[b] ??= { produced: {}, consumed: {}, starved: 0 });

function each(w: SimWorld, fn: (s: FlowSnapshot) => void): void {
  fn(w.state.flows.cur); fn(w.state.flows.total);
}

export function flowProduce(w: SimWorld, b: BuildingId, k: ResourceKind, n: number): void {
  each(w, (s) => { const c = counters(s, b); c.produced[k] = (c.produced[k] ?? 0) + n; });
}
export function flowConsume(w: SimWorld, b: BuildingId, k: ResourceKind, n: number): void {
  each(w, (s) => { const c = counters(s, b); c.consumed[k] = (c.consumed[k] ?? 0) + n; });
}
export function flowStarve(w: SimWorld, b: BuildingId): void {
  each(w, (s) => { counters(s, b).starved++; });
}
/** Переміщення ресурсу від будівлі до будівлі (from = 0 — природа). */
export function flowEdge(w: SimWorld, from: BuildingId, to: BuildingId, k: ResourceKind, n: number): void {
  const key = flowEdgeKey(from, to, k);
  each(w, (s) => { s.edges[key] = (s.edges[key] ?? 0) + n; });
}

/** Закрити вікно: cur -> last. Викликається з тіка. */
export function rollFlowWindow(w: SimWorld): void {
  const f = w.state.flows;
  if (w.state.tick - f.windowStart < f.windowTicks) return;
  f.last = f.cur;
  f.cur = emptyFlowSnapshot();
  f.windowStart = w.state.tick;
}

/** Швидкість (од./с) ресурсу для будівлі за останнє закрите вікно. */
export function ratePerSec(w: SimWorld, b: BuildingId, kind: 'produced' | 'consumed', k: ResourceKind, hz = 10): number {
  const c = w.state.flows.last.byBuilding[b];
  return ((c?.[kind][k] ?? 0) * hz) / w.state.flows.windowTicks;
}
