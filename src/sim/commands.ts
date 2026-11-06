import type {
  BuildingKind, BuildingState, CommandEnvelope, CommandRejectReason, CommandResult, ResourceKind,
} from '../shared';
import { COSTS, FOOTPRINT, JOB_OF, MAX_WORKERS, PLACE_MARGIN, START_SETTLERS, START_STOCK, STORAGE_CAP } from './balance';
import { assignNpc, autoStaffIdle, slotsOf, unassignNpc } from './assign';
import { spawnNpc } from './npcs';
import { syncPlayerResources } from './step';
import { C as CELLS, CENTER_TILE, NODE_NONE, T as TILES, TPC, getSectorRt, markFootprint, nodeTile, rebuildIndex, type SimWorld } from './world';

type Res = { ok: true } | { ok: false; reason: CommandRejectReason };
const no = (reason: CommandRejectReason): Res => ({ ok: false, reason });

function addBuilding(w: SimWorld, kind: BuildingKind, owner: string, sector: number, x: number, y: number): BuildingState {
  const rt = getSectorRt(w, sector);
  const size = { ...(FOOTPRINT[kind] ?? { w: 6, h: 6 }) };
  const b: BuildingState = {
    id: w.state.nextBuildingId++, kind, owner, sector, cell: { x, y }, size,
    entrance: { x: x + (size.w >> 1), y: y + size.h }, // по центру нижньої межі footprint
    progress: 1, roadAttached: false, stock: {}, workers: [],
  };
  w.state.buildings.push(b);
  markFootprint(rt, b, 1);
  rebuildIndex(w);
  return b;
}

/**
 * Чи можна поставити будівлю з лівим верхнім тайлом (x,y): у межах сектора, footprint і вхід вільні,
 * поруч (запас PLACE_MARGIN тайлів) немає вузлів ресурсів. Повертає причину відмови або null.
 */
export function checkPlace(w: SimWorld, sector: number, kind: BuildingKind, x: number, y: number): 'invalid' | 'occupied' | null {
  const fp = FOOTPRINT[kind];
  if (!fp || !Number.isInteger(x) || !Number.isInteger(y)) return 'invalid';
  if (x < 0 || y < 0 || x + fp.w > TILES || y + fp.h + 1 > TILES) return 'invalid';
  const rt = getSectorRt(w, sector);
  for (let ty = y; ty <= y + fp.h; ty++) {
    for (let tx = x; tx < x + fp.w; tx++) if (rt.occ[ty * TILES + tx]) return 'occupied';
  }
  const m = PLACE_MARGIN;
  const cx0 = Math.max(0, Math.floor((x - m) / TPC)), cx1 = Math.min(CELLS - 1, Math.floor((x + fp.w + m) / TPC));
  const cy0 = Math.max(0, Math.floor((y - m) / TPC)), cy1 = Math.min(CELLS - 1, Math.floor((y + fp.h + m) / TPC));
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (rt.kind[cx + cy * CELLS] === NODE_NONE) continue;
      const nt = nodeTile(w.state.world.seed, sector, cx, cy);
      if (nt.x >= x - m && nt.x < x + fp.w + m && nt.y >= y - m && nt.y < y + fp.h + 1 + m) return 'occupied';
    }
  }
  return null;
}

/** Ратуша в центрі домашнього сектора + стартові поселенці й запас. Після claimStart. */
export function startCity(w: SimWorld, playerId: string): BuildingState | null {
  const pi = w.state.players.findIndex((p) => p.id === playerId);
  const home = w.state.players[pi]?.homeSector;
  if (pi < 0 || home === null || home === undefined) return null;
  const fp = FOOTPRINT.townhall!;
  const hall = addBuilding(w, 'townhall', playerId, home, CENTER_TILE - (fp.w >> 1), CENTER_TILE - (fp.h >> 1));
  hall.stock = { ...START_STOCK };
  for (let k = 0; k < START_SETTLERS; k++) spawnNpc(w, pi, home, hall.entrance.x, hall.entrance.y);
  w.events.push({ e: 'building_placed', building: hall.id });
  syncPlayerResources(w);
  return hall;
}

/** Чи можна побудувати: що саме бракує (для підказки в UI). Перший лісоруб гравця безкоштовний — страховка від глухого кута. */
export function buildCheck(w: SimWorld, player: string, kind: BuildingKind): { ok: boolean; free: boolean; missing: Partial<Record<ResourceKind, number>> } {
  const cost = COSTS[kind];
  if (!cost) return { ok: false, free: false, missing: {} };
  const free = w.freeBuild || (kind === 'lumberjack' && !w.state.buildings.some((b) => b.owner === player && b.kind === 'lumberjack'));
  const missing: Partial<Record<ResourceKind, number>> = {};
  if (!free) for (const [k, v] of Object.entries(cost)) {
    const lack = (v ?? 0) - total(w, player, k as ResourceKind);
    if (lack > 0) missing[k as ResourceKind] = lack;
  }
  return { ok: Object.keys(missing).length === 0, free, missing };
}

function total(w: SimWorld, owner: string, k: ResourceKind): number {
  let t = 0;
  for (const b of w.state.buildings) if (b.owner === owner && STORAGE_CAP[b.kind]) t += b.stock[k] ?? 0;
  return t;
}
function pay(w: SimWorld, owner: string, cost: Partial<Record<ResourceKind, number>>): void {
  for (const [k, v] of Object.entries(cost)) {
    let left = v ?? 0;
    for (const b of w.state.buildings) {
      if (left <= 0) break;
      if (b.owner !== owner || !STORAGE_CAP[b.kind]) continue;
      const take = Math.min(left, b.stock[k as ResourceKind] ?? 0);
      if (take) { b.stock[k as ResourceKind] = (b.stock[k as ResourceKind] ?? 0) - take; left -= take; }
    }
  }
}

const unassign = unassignNpc;

function validNpc(w: SimWorld, player: string, npc: number): boolean {
  const n = w.state.npcs;
  return npc >= 0 && npc < n.capacity && n.alive[npc] === 1 && w.state.players[n.owner[npc]]?.id === player;
}

export function applyCommand(w: SimWorld, env: CommandEnvelope): CommandResult {
  const r = apply(w, env);
  return r.ok ? { seq: env.seq, ok: true } : { seq: env.seq, ok: false, reason: r.reason };
}

function apply(w: SimWorld, { player, cmd }: CommandEnvelope): Res {
  const st = w.state;
  switch (cmd.type) {
    case 'place_building': {
      const sec = st.sectors[cmd.sector];
      if (!sec) return no('invalid');
      if (sec.owner !== player) return no('not_owner');
      const cost = COSTS[cmd.kind];
      if (!cost) return no('invalid');
      const { x, y } = cmd.cell;
      const why = checkPlace(w, cmd.sector, cmd.kind, x, y);
      if (why) return no(why);
      const chk = buildCheck(w, player, cmd.kind);
      if (!chk.ok) return no('no_resources');
      if (!chk.free) pay(w, player, cost);
      const b = addBuilding(w, cmd.kind, player, cmd.sector, x, y);
      w.events.push({ e: 'building_placed', building: b.id });
      syncPlayerResources(w);
      return { ok: true };
    }
    case 'demolish_building': {
      const b = w.byId.get(cmd.building);
      if (!b) return no('invalid');
      if (b.owner !== player) return no('not_owner');
      if (b.kind === 'townhall') return no('invalid');
      for (const id of [...b.workers]) unassign(w, id);
      st.buildings = st.buildings.filter((x) => x !== b);
      markFootprint(getSectorRt(w, b.sector), b, -1);
      rebuildIndex(w);
      w.events.push({ e: 'building_removed', building: b.id });
      return { ok: true };
    }
    case 'assign_worker': {
      if (!validNpc(w, player, cmd.npc)) return no('not_owner');
      if (cmd.building === null) { unassign(w, cmd.npc); w.npc.manual[cmd.npc] = 1; return { ok: true }; }
      const b = w.byId.get(cmd.building);
      if (!b || b.owner !== player) return no('not_owner');
      if (JOB_OF[b.kind] !== cmd.profession) return no('invalid');
      if (w.state.npcs.sector[cmd.npc] !== b.sector) return no('invalid');
      if (!b.workers.includes(cmd.npc) && b.workers.length >= slotsOf(b)) {
        // ручне призначення відкриває ще одне місце, якщо воно в межах максимуму будівлі
        if (b.workers.length >= (MAX_WORKERS[b.kind] ?? 0)) return no('occupied');
        b.workerCap = b.workers.length + 1;
      }
      assignNpc(w, cmd.npc, b);
      return { ok: true };
    }
    case 'set_building_paused': {
      const b = w.byId.get(cmd.building);
      if (!b) return no('invalid');
      if (b.owner !== player) return no('not_owner');
      if (b.kind !== 'sawmill') return no('invalid'); // лише переробники
      b.paused = cmd.paused;
      return { ok: true };
    }
    case 'set_worker_count': {
      const b = w.byId.get(cmd.building);
      if (!b || !JOB_OF[b.kind] || !Number.isInteger(cmd.count)) return no('invalid');
      if (b.owner !== player) return no('not_owner');
      const count = Math.max(0, Math.min(MAX_WORKERS[b.kind] ?? 0, cmd.count));
      b.workerCap = count;
      // Зменшення: зайвих звільняємо (не «manual»: вони самі шукають іншу роботу). Автопризначення не чіпає тих, хто лишився.
      while (b.workers.length > count) unassign(w, b.workers[b.workers.length - 1]);
      autoStaffIdle(w);
      return { ok: true };
    }
    case 'unassign_worker':
      if (!validNpc(w, player, cmd.npc)) return no('not_owner');
      unassign(w, cmd.npc);
      w.npc.manual[cmd.npc] = 1;
      return { ok: true };
    default:
      return no('invalid'); // решта команд — поза етапом економіки
  }
}

/** Допоміжне: призначити вільних NPC гравця в секторі на будівлю (через команди). Повертає кількість. */
export function staffBuilding(w: SimWorld, player: string, buildingId: number, max = Infinity): number {
  const b = w.byId.get(buildingId), job = b && JOB_OF[b.kind];
  if (!b || !job) return 0;
  const n = w.state.npcs;
  let done = 0;
  for (let i = 0; i < n.capacity && b.workers.length < slotsOf(b) && done < max; i++) {
    if (!n.alive[i] || n.sector[i] !== b.sector || w.npc.workplace[i] >= 0) continue;
    if (applyCommand(w, { player, seq: 0, cmd: { type: 'assign_worker', npc: i, profession: job, building: b.id } }).ok) done++;
  }
  return done;
}

export const idleNpcs = (w: SimWorld, player: string): number[] => {
  const n = w.state.npcs, out: number[] = [];
  for (let i = 0; i < n.capacity; i++) if (n.alive[i] && w.npc.workplace[i] < 0 && w.state.players[n.owner[i]]?.id === player) out.push(i);
  return out;
};
