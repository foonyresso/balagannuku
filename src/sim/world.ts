import type {
  BuildingId, BuildingState, GameEvent, GameState, NpcStore, PackedNpcStore, PlayerState, SectorState,
  SerializedGameState, TrailLayer,
} from '../shared';
import { BORDER_CELLS, NPC_STAT_BASE, NPC_STAT_COUNT, SECTOR_CELLS, SECTOR_SIZE, TILES_PER_CELL, createTrailLayer, isActiveCell, isActiveTile, stageFromTraffic } from '../shared';
import { hash2 } from './rng';
import { fillWater, nearestShore } from './water';
import { refreshClear } from './clear';
import { genNode, mixNodeSeed } from './nodegen';
import { NPC_CAPACITY, SOLID_RECT, STONE_AMOUNT, TREE_AMOUNT } from './balance';
import { createInitialState } from './worldgen';
import { pack, unpack } from './pack';

export const NODE_NONE = 0, NODE_TREE = 1, NODE_STONE = 2;
export const T = SECTOR_SIZE; // тайлів на сторону
export const C = SECTOR_CELLS; // клітинок навігації на сторону
export const TPC = TILES_PER_CELL;
export const CENTER_CELL = C >> 1;
export const CENTER_TILE = T >> 1;
export const tileIndex = (tx: number, ty: number): number => ty * T + tx;
export const cellOfTile = (tx: number, ty: number): number => Math.floor(ty / TPC) * C + Math.floor(tx / TPC);

/** Робочі (не серіалізовані напряму) дані сектора. Тайли — T×T, клітинки навігації — C×C. */
export interface SectorRt {
  id: number;
  trails: TrailLayer; // трафік по тайлах
  stage: Uint8Array; // стадія стежки по тайлах
  cellStage: Uint8Array; // макс. стадія тайлів у клітинці (для вартості A*)
  occ: Uint8Array; // тайл зайнятий footprint будівлі (а також вода й неактивна смуга)
  water: Uint8Array; // тайл: 1 = вода (озеро/річка), похідне від seed; водночас occ=1
  blocked1: Uint8Array; // клітинка без вільних вузлів для малого NPC (1 тайл)
  blocked2: Uint8Array; // клітинка без вільних вузлів для стандартного NPC (2 тайли)
  kind: Uint8Array; // клітинка: вид вузла ресурсу (похідний від seed)
  amount: Uint8Array; // клітинка: стан вузла (0 = зрубано, відростає)
  forest: Uint8Array; // клітинка: 1 = є живе дерево (дорожче йти)
  claimBy: Int32Array; // клітинка: NPC+1, що обрав цей вузол (щоб працівники розходились по різних деревах)
  buildings: BuildingState[];
}

/** Робочий стан NPC (не серіалізується; після завантаження NPC перепланують дію). */
export interface NpcRt {
  phase: Uint8Array;
  timer: Uint16Array;
  workplace: Int32Array;
  aux: Int32Array; // допоміжне: клітинка вузла / будівля-джерело
  path: (Float32Array | null)[]; // пари (x,y) у тайлах
  pathPos: Uint16Array; // індекс у path (кроком 2)
  /** Позиція NPC на початку останнього тіка (для плавної інтерполяції в рендері). */
  px: Float32Array;
  py: Float32Array;
  /** 0 = несе сировину (збирає/до хатинки), 1 = оброблене (готове до доставки). */
  stage: Uint8Array;
  /** 1 = гравець сам зняв NPC з роботи: автопризначення його не чіпає. */
  manual: Uint8Array;
  tile: Int32Array; // тайл, у якому NPC був востаннє (для трафіку)
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
  /** Остання причина простою будівлі (для підказок UI): no_node, no_storage, storage_full, no_wood, no_path, paused. Не серіалізується. */
  why: Map<BuildingId, string>;
}

/** Стати за замовчуванням (норма) для capacity NPC. */
export function defaultStats(capacity: number): Uint8Array {
  const a = new Uint8Array(capacity * NPC_STAT_COUNT);
  for (let i = 0; i < capacity; i++) for (let s = 0; s < NPC_STAT_COUNT; s++) a[i * NPC_STAT_COUNT + s] = NPC_STAT_BASE[s];
  return a;
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
    nameId: new Uint16Array(capacity), stats: defaultStats(capacity), perks: new Uint16Array(capacity),
    fullness: new Uint8Array(capacity).fill(100),
  };
}

function createNpcRt(capacity: number): NpcRt {
  return {
    phase: new Uint8Array(capacity), timer: new Uint16Array(capacity),
    workplace: new Int32Array(capacity).fill(-1), aux: new Int32Array(capacity).fill(-1),
    path: new Array(capacity).fill(null), pathPos: new Uint16Array(capacity), tile: new Int32Array(capacity).fill(-1), manual: new Uint8Array(capacity), stage: new Uint8Array(capacity), px: new Float32Array(capacity), py: new Float32Array(capacity),
  };
}

/** Тайл-якір вузла в клітинці (детермінований зсув усередині клітинки, щоб ліс не був ґратчастим). */
export function nodeTile(seed: number, sectorId: number, cx: number, cy: number): { x: number; y: number } {
  const j = TPC - 2;
  return {
    x: cx * TPC + 1 + Math.floor(hash2(cx, cy, seed ^ 0x51 ^ sectorId) * (j + 1)),
    y: cy * TPC + 1 + Math.floor(hash2(cy, cx, seed ^ 0xa3 ^ sectorId) * (j + 1)),
  };
}

/** Вид і початковий залишок вузла (клітинка навігації) ресурсу в клітинці — чиста функція від seed. */
export function nodeAt(seed: number, sec: SectorState, x: number, y: number): [number, number] {
  const k = genNode(mixNodeSeed(seed, sec.id), sec.richness.wood ?? 0.3, sec.richness.stone ?? 0.3, x, y, CENTER_CELL);
  return k === NODE_TREE ? [NODE_TREE, TREE_AMOUNT] : k === NODE_STONE ? [NODE_STONE, STONE_AMOUNT] : [NODE_NONE, 0];
}

export function getSectorRt(w: SimWorld, id: number): SectorRt {
  let rt = w.sectors.get(id);
  if (rt) return rt;
  const sec = w.state.sectors[id];
  const nc = C * C, nt = T * T;
  rt = {
    id, trails: createTrailLayer(), stage: new Uint8Array(nt), cellStage: new Uint8Array(nc), occ: new Uint8Array(nt), water: new Uint8Array(nt),
    blocked1: new Uint8Array(nc), blocked2: new Uint8Array(nc), kind: new Uint8Array(nc), amount: new Uint8Array(nc), forest: new Uint8Array(nc), claimBy: new Int32Array(nc), buildings: [],
  };
  if (sec.trails) rt.trails.traffic = unpack(sec.trails);
  const saved = sec.nodes ? unpack<Uint8Array>(sec.nodes) : null;
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const i = y * C + x;
      const [k, a] = nodeAt(w.state.world.seed, sec, x, y);
      rt.kind[i] = k;
      rt.amount[i] = saved ? saved[i] : a;
      rt.forest[i] = k === NODE_TREE && rt.amount[i] > 0 ? 1 : 0;
    }
  }
  // неактивна смуга: тайли зайняті назавжди (прохід і будівництво заборонені), вузлів ресурсів у симуляції немає
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) if (!isActiveTile(x, y)) rt.occ[y * T + x] = 1;
  }
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) if (!isActiveCell(x, y)) { const i = y * C + x; rt.kind[i] = 0; rt.amount[i] = 0; rt.forest[i] = 0; }
  }
  refreshClear(rt.occ, rt.blocked1, rt.blocked2, 0, C - 1, 0, BORDER_CELLS);
  refreshClear(rt.occ, rt.blocked1, rt.blocked2, 0, C - 1, C - 1 - BORDER_CELLS, C - 1);
  refreshClear(rt.occ, rt.blocked1, rt.blocked2, 0, BORDER_CELLS, 0, C - 1);
  refreshClear(rt.occ, rt.blocked1, rt.blocked2, C - 1 - BORDER_CELLS, C - 1, 0, C - 1);
  // вода: непрохідна, будувати не можна; вузли ресурсів у воді прибираємо
  if (fillWater(w.state.world.seed, rt.water, T) > 0) {
    const dirty = new Uint8Array(nc);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (!rt.water[y * T + x]) continue;
        rt.occ[y * T + x] = 1;
        const cx = (x / TPC) | 0, cy = (y / TPC) | 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) if (cx + dx >= 0 && cy + dy >= 0) dirty[(cy + dy) * C + cx + dx] = 1;
      }
    }
    for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) if (dirty[cy * C + cx]) refreshClear(rt.occ, rt.blocked1, rt.blocked2, cx, cx, cy, cy);
    for (let cy = 0; cy < C; cy++) {
      for (let cx = 0; cx < C; cx++) {
        const i = cy * C + cx;
        if (!rt.kind[i]) continue;
        const nt = nodeTile(w.state.world.seed, id, cx, cy);
        if (rt.water[nt.y * T + nt.x]) { rt.kind[i] = 0; rt.amount[i] = 0; rt.forest[i] = 0; }
      }
    }
  }
  for (let i = 0; i < nt; i++) {
    const st = stageFromTraffic(rt.trails.traffic[i]);
    rt.stage[i] = st;
    if (st) { const c = cellOfTile(i % T, (i / T) | 0); if (st > rt.cellStage[c]) rt.cellStage[c] = st; }
  }
  w.sectors.set(id, rt);
  for (const b of w.state.buildings) if (b.sector === id) markFootprint(rt, b, 1);
  rebuildIndex(w);
  return rt;
}

/** Позначити (delta=1) або зняти (delta=-1) footprint будівлі в occ (тайли) і blocked (клітинки). */
export function markFootprint(rt: SectorRt, b: BuildingState, delta: 1 | -1): void {
  const sr = SOLID_RECT[b.kind], sx = b.cell.x + (sr?.x ?? 0), sy = b.cell.y + (sr?.y ?? 0), sw = sr?.w ?? b.size.w, sh = sr?.h ?? b.size.h;
  for (let y = sy; y < sy + sh; y++) {
    for (let x = sx; x < sx + sw; x++) rt.occ[y * T + x] = delta === 1 ? 1 : 0;
  }
  // карти прохідності класів розміру: клітинки навколо footprint (+запас під вершини й сусідні тайли)
  refreshClear(rt.occ, rt.blocked1, rt.blocked2, Math.floor((b.cell.x - 2) / TPC), Math.floor((b.cell.x + b.size.w + 2) / TPC), Math.floor((b.cell.y - 2) / TPC), Math.floor((b.cell.y + b.size.h + 2) / TPC));
}

/** Оновити cellStage клітинки після зміни стадії тайла. */
export function refreshCellStage(rt: SectorRt, cell: number): void {
  const cx = cell % C, cy = (cell / C) | 0;
  let m = 0;
  for (let y = cy * TPC; y < cy * TPC + TPC; y++) for (let x = cx * TPC; x < cx * TPC + TPC; x++) m = Math.max(m, rt.stage[y * T + x]);
  rt.cellStage[cell] = m;
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
    events: [], stageChanges: [], freeBuild: false, why: new Map(),
  };
  rebuildIndex(w);
  w.npc.px.set(full.npcs.x); w.npc.py.set(full.npcs.y);
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
  // Старі сейви (до v5) без імен/статів/перків: заповнюємо нормою
  if (!npcs.stats) npcs.stats = defaultStats(pn.capacity);
  else if ((npcs.stats as Uint8Array).length !== pn.capacity * NPC_STAT_COUNT) { // старий stride статів (до size)
    const old = npcs.stats as Uint8Array, oldN = old.length / pn.capacity, fresh = defaultStats(pn.capacity);
    for (let i = 0; i < pn.capacity; i++) for (let s = 0; s < Math.min(oldN, NPC_STAT_COUNT); s++) fresh[i * NPC_STAT_COUNT + s] = old[i * oldN + s];
    npcs.stats = fresh;
  }
  if (!npcs.nameId) npcs.nameId = new Uint16Array(pn.capacity);
  if (!npcs.fullness) npcs.fullness = new Uint8Array(pn.capacity).fill(100);
  if (!npcs.perks) npcs.perks = new Uint16Array(pn.capacity);
  const w = wrapState({ ...rest, npcs: npcs as unknown as NpcStore }, pn.capacity);
  for (const b of w.state.buildings) {
    getSectorRt(w, b.sector);
    for (const id of b.workers) w.npc.workplace[id] = b.id;
  }
  return w;
}

/** Контракт для економіки: чи вода в тайлі (x, y) сектора. Поза картою — false. */
export function isWaterTile(w: SimWorld, sector: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= T || y >= T) return false;
  return getSectorRt(w, sector).water[y * T + x] === 1;
}
/** Найближчий до (x, y) берег (сухий вільний тайл поруч із водою) у радіусі maxR тайлів + тайл води, на який він дивиться. */
export function shoreNear(w: SimWorld, sector: number, x: number, y: number, maxR = 64) {
  return nearestShore(getSectorRt(w, sector), T, x, y, maxR);
}
