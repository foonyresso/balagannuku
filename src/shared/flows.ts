import type { BuildingId, ResourceKind, Tick } from './ids';

/**
 * Облік потоків ресурсів — основа майбутнього візуалізатора ланцюжків (як Satisfactory/Factorio).
 * Три знімки: `cur` (поточне вікно), `last` (останнє закрите вікно -> швидкості), `total` (з початку гри).
 * Швидкість за секунду = last.* / (windowTicks / SIM_TICK_HZ).
 */
export interface FlowCounters {
  produced: Partial<Record<ResourceKind, number>>;
  consumed: Partial<Record<ResourceKind, number>>;
  /** Тіки (NPC·тіки), коли будівля простоювала через нестачу входу/місця. Показує «вузькі місця». */
  starved: number;
}

export interface FlowSnapshot {
  byBuilding: Record<BuildingId, FlowCounters>;
  /** Ребра графа: `${from}>${to}:${ресурс}` -> кількість. from = 0 — природа (вузол ресурсу). */
  edges: Record<string, number>;
}

export interface FlowLedger {
  windowTicks: number;
  windowStart: Tick;
  cur: FlowSnapshot;
  last: FlowSnapshot;
  total: FlowSnapshot;
}

export const FLOW_WINDOW_TICKS = 100;
export const FLOW_NATURE = 0;
/** Населення як «споживач» у ребрах потоків (їжа: склад -> люди). */
export const FLOW_PEOPLE = -1;

export const flowEdgeKey = (from: BuildingId, to: BuildingId, kind: ResourceKind): string => `${from}>${to}:${kind}`;
export const emptyFlowSnapshot = (): FlowSnapshot => ({ byBuilding: {}, edges: {} });

export function createFlowLedger(): FlowLedger {
  return {
    windowTicks: FLOW_WINDOW_TICKS, windowStart: 0,
    cur: emptyFlowSnapshot(), last: emptyFlowSnapshot(), total: emptyFlowSnapshot(),
  };
}
