import type {
  BuildingId, BuildingState, GameEvent, GameState, NpcStore, PackedNpcStore, PlayerState, SectorState,
  SerializedGameState, TrailLayer,
} from '../shared';
import { SECTOR_SIZE, createTrailLayer, stageFromTraffic } from '../shared';
import { fbm } from './noise';
import { hash2 } from './rng';
import { NPC_CAPACITY, STONE_AMOUNT, TREE_AMOUNT } from './balance';
import { createInitialState } from './worldgen';
import { pack, unpack } from './pack';

export const NODE_NONE = 0, NODE_TREE = 1, NODE_STONE = 2;
export const S = SECTOR_SIZE;
export const CENTER = S >> 1;

/** Робочі (не серіалізовані напряму) дані сектора. */
export interface SectorRt {
  id: number;
  trails: TrailLayer;
  stage: Uint8Array;
  kind: Uint8Array; // вид вузла (похідний від seed)
  amount: Uint8Array; // залишок у вузлі
  blocked: Uint8Array; // зайнято будівлею
  forest: Uint8Array; // 1 = є живе дерево
  buildings: BuildingState[];
}

/** Робочий стан NPC (не серіалізується; після завантаження NPC перепланують дію). */
export interface NpcRt {
  phase: Uint8Array;
  timer: Uint16Array;
  workplace: Int32Array;
  aux: Int32Array; // допоміжне: клітинка вузла / будівля-джерело
  path: (Int16Array | null)[];
  pathPos: Uint16Array;
}

export interface SimWorld {
  state: GameState;
  sectors: Map<number, SectorRt>;
  npc: NpcRt;
  byId: Map<BuildingId, BuildingState>;
  events: GameEvent[];
  stageChanges: { sector: number; cell: number; stage: number }[];
  /** Будівництво без витрат (тести/бенчмарк). */
  freeBuild: boolean;
}

export function createNpcStore(capacity: number): NpcStore {
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity), sector: new Uint16Array(capacity),
    x: new Float32Array(capacity), y: new Float32Array(capacity),
    profession: new Uint8Array(capacity), task: new Uint8Array(capacity),
    targetBuilding: new Int32Array(capacity).fill(-1), owner: new Uint8Array(capacity),
    hp: new Uint16Array(capacity), level: new Uint8Array(capacity),
    inventory: new Uint16Array(capacity * 8), equipment: new Uint16Array(capacity * 4),
    carryKind: new Uint8Array(capacity).fill(255), carryAmount: new Uint8Array(capacity),
  };
}

function createNpcRt(capacity: number): NpcRt {
  return {
    phase: new Uint8Array(capacity), timer: new Uint16Array(capacity),
    workplace: new Int32Array(capacity).fill(-1), aux: new Int32Array(capacity).fill(-1),
    path: new Array(capacity).fill(null), pathPos: new Uint16Array(capacity),
  };
}

/** Вид і початковий залишок вузла ресурсу в клітинці — чиста функція від seed. */
export function nodeAt(seed: number, sec: SectorState, x: number, y: number): [number, number] {
  if (Math.abs(x - CENTER) < 5 && Math.abs(y - CENTER) < 5) return [NODE_NONE, 0];
  const wood = sec.richness.wood ?? 0.3, stone = sec.richness.stone ?? 0.3;
  const ox = sec.id * 13.7, oy = seed % 97;
  const h = hash2(x, y, seed ^ (sec.id * 7919));
  if (fbm(x * 0.1 + ox, y * 0.1 + oy, 101) > 0.62 - 0.3 * wood && h < 0.55) return [NODE_TREE, TREE_AMOUNT];
  if (fbm(x * 0.14 + ox, y * 0.14 + oy, 202) > 0.7 - 0.3 * stone && h > 0.5) return [NODE_STONE, STONE_AMOUNT];
  return [NODE_NONE, 0];
}

export function getSectorRt(w: SimWorld, id: number): SectorRt {
  let rt = w.sectors.get(id);
  if (rt) return rt;
  const sec = w.state.sectors[id];
  const n = S * S;
  rt = {
    id, trails: createTrailLayer(), stage: new Uint8Array(n), kind: new Uint8Array(n),
    amount: new Uint8Array(n), blocked: new Uint8Array(n), forest: new Uint8Array(n), buildings: [],
  };
  if (sec.trails) rt.trails.traffic = unpack(sec.trails);
  const saved = sec.nodes ? unpack<Uint8Array>(sec.nodes) : null;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const [k, a] = nodeAt(w.state.world.seed, sec, x, y);
      rt.kind[i] = k;
      rt.amount[i] = saved ? saved[i] : a;
      rt.forest[i] = k === NODE_TREE && rt.amount[i] > 0 ? 1 : 0;
      rt.stage[i] = stageFromTraffic(rt.trails.traffic[i]);
    }
  }
  w.sectors.set(id, rt);
  for (const b of w.state.buildings) if (b.sector === id) rt.blocked[b.cell.y * S + b.cell.x] = 1;
  rebuildIndex(w);
  return rt;
}

/** Перебудувати індекси будівель (після змін списку). */
export function rebuildIndex(w: SimWorld): void {
  w.byId.clear();
  for (const rt of w.sectors.values()) rt.buildings = [];
  for (const b of w.state.buildings) {
    w.byId.set(b.id, b);
    w.sectors.get(b.sector)?.buildings.push(b);
  }
}

export function wrapState(state: Omit<GameState, 'npcs'> & { npcs?: NpcStore }, capacity = NPC_CAPACITY): SimWorld {
  const full = state as GameState;
  if (!full.npcs) full.npcs = createNpcStore(capacity);
  const w: SimWorld = {
    state: full, sectors: new Map(), npc: createNpcRt(full.npcs.capacity), byId: new Map(),
    events: [], stageChanges: [], freeBuild: false,
  };
  rebuildIndex(w);
  return w;
}

/** Новий світ для симуляції. */
export function createWorld(seed: number, players: PlayerState[], radius?: number, minStartDistance?: number): SimWorld {
  return wrapState(createInitialState(seed, radius, minStartDistance, players));
}

/** Серіалізація в JSON-дружній вигляд (для сейва/знімка). Не мутує світ. */
export function serialize(w: SimWorld): SerializedGameState {
  const { npcs, ...rest } = w.state;
  const copy = structuredClone(rest) as Omit<GameState, 'npcs'>;
  for (const [id, rt] of w.sectors) {
    copy.sectors[id].trails = pack(rt.trails.traffic) as SectorState['trails'];
    copy.sectors[id].nodes = pack(rt.amount);
  }
  const packed: Record<string, unknown> = { capacity: npcs.capacity, count: npcs.count };
  for (const [k, v] of Object.entries(npcs)) if (typeof v !== 'number') packed[k] = pack(v);
  return { ...copy, npcs: packed as unknown as PackedNpcStore };
}

export function deserialize(s: SerializedGameState): SimWorld {
  const { npcs: pn, ...rest } = structuredClone(s);
  const npcs: Record<string, unknown> = { capacity: pn.capacity, count: pn.count };
  for (const [k, v] of Object.entries(pn)) if (typeof v !== 'number') npcs[k] = unpack(v);
  const w = wrapState({ ...rest, npcs: npcs as unknown as NpcStore }, pn.capacity);
  for (const b of w.state.buildings) {
    getSectorRt(w, b.sector);
    for (const id of b.workers) w.npc.workplace[id] = b.id;
  }
  return w;
}
