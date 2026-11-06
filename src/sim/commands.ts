import type {
  BuildingKind, BuildingState, CommandEnvelope, CommandRejectReason, CommandResult, ResourceKind,
} from '../shared';
import { PROFESSIONS } from '../shared';
import { COSTS, JOB_OF, MAX_WORKERS, START_SETTLERS, START_STOCK, STORAGE_CAP } from './balance';
import { spawnNpc } from './npcs';
import { syncPlayerResources } from './step';
import { CENTER, NODE_NONE, S, getSectorRt, rebuildIndex, type SimWorld } from './world';

type Res = { ok: true } | { ok: false; reason: CommandRejectReason };
const no = (reason: CommandRejectReason): Res => ({ ok: false, reason });

function addBuilding(w: SimWorld, kind: BuildingKind, owner: string, sector: number, x: number, y: number): BuildingState {
  const rt = getSectorRt(w, sector);
  const b: BuildingState = {
    id: w.state.nextBuildingId++, kind, owner, sector, cell: { x, y }, entrance: { x, y: y + 1 },
    progress: 1, roadAttached: false, stock: {}, workers: [],
  };
  w.state.buildings.push(b);
  rt.blocked[y * S + x] = 1;
  rebuildIndex(w);
  return b;
}

/** Ратуша в центрі домашнього сектора + стартові поселенці й запас. Після claimStart. */
export function startCity(w: SimWorld, playerId: string): BuildingState | null {
  const pi = w.state.players.findIndex((p) => p.id === playerId);
  const home = w.state.players[pi]?.homeSector;
  if (pi < 0 || home === null || home === undefined) return null;
  const hall = addBuilding(w, 'townhall', playerId, home, CENTER, CENTER);
  hall.stock = { ...START_STOCK };
  for (let k = 0; k < START_SETTLERS; k++) spawnNpc(w, pi, home, hall.entrance.x, hall.entrance.y);
  w.events.push({ e: 'building_placed', building: hall.id });
  syncPlayerResources(w);
  return hall;
}

function canPay(w: SimWorld, owner: string, cost: Partial<Record<ResourceKind, number>>): boolean {
  return Object.entries(cost).every(([k, v]) => total(w, owner, k as ResourceKind) >= (v ?? 0));
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

function unassign(w: SimWorld, npc: number): void {
  const cur = w.npc.workplace[npc];
  const b = cur >= 0 ? w.byId.get(cur) : undefined;
  if (b) b.workers = b.workers.filter((id) => id !== npc);
  const n = w.state.npcs;
  w.npc.workplace[npc] = -1; w.npc.phase[npc] = 0; w.npc.path[npc] = null;
  n.profession[npc] = 0; n.task[npc] = 0;
}

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
      if (x < 0 || y < 0 || x >= S || y + 1 >= S) return no('invalid');
      const rt = getSectorRt(w, cmd.sector);
      const free = (i: number) => !rt.blocked[i] && rt.kind[i] === NODE_NONE;
      if (!free(y * S + x) || rt.blocked[(y + 1) * S + x]) return no('occupied');
      if (!w.freeBuild) {
        if (!canPay(w, player, cost)) return no('no_resources');
        pay(w, player, cost);
      }
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
      getSectorRt(w, b.sector).blocked[b.cell.y * S + b.cell.x] = 0;
      rebuildIndex(w);
      w.events.push({ e: 'building_removed', building: b.id });
      return { ok: true };
    }
    case 'assign_worker': {
      if (!validNpc(w, player, cmd.npc)) return no('not_owner');
      if (cmd.building === null) { unassign(w, cmd.npc); return { ok: true }; }
      const b = w.byId.get(cmd.building);
      if (!b || b.owner !== player) return no('not_owner');
      if (JOB_OF[b.kind] !== cmd.profession) return no('invalid');
      if (!b.workers.includes(cmd.npc) && b.workers.length >= (MAX_WORKERS[b.kind] ?? 0)) return no('occupied');
      if (w.state.npcs.sector[cmd.npc] !== b.sector) return no('invalid');
      unassign(w, cmd.npc);
      b.workers.push(cmd.npc);
      w.npc.workplace[cmd.npc] = b.id;
      w.state.npcs.profession[cmd.npc] = PROFESSIONS.indexOf(cmd.profession);
      return { ok: true };
    }
    case 'unassign_worker':
      if (!validNpc(w, player, cmd.npc)) return no('not_owner');
      unassign(w, cmd.npc);
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
  for (let i = 0; i < n.capacity && b.workers.length < (MAX_WORKERS[b.kind] ?? 0) && done < max; i++) {
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
