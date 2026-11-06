import type { BuildingState, ResourceKind } from '../shared';
import {
  PROFESSIONS, RESOURCE_KINDS, ROAD_ATTACH_MIN_STAGE, ROAD_SPEED_MULT, TASKS, TRAIL_DECAY_FACTOR,
  TRAIL_DECAY_INTERVAL, TRAIL_MAX, TRAIL_STEP_ADD, TrailStage, stageFromTraffic,
} from '../shared';
import {
  ATTACHED_WORK_MULT, CARRY_CAP, HOUSE_SPAWN_INTERVAL, MILL_BUFFER, MILL_TICKS, WOOD_RESERVE, NPC_SPEED, POP_BASE, POP_PER_HOUSE,
  ROAD_CHECK_INTERVAL, STONE_AMOUNT, STORAGE_CAP, TREE_AMOUNT, TREE_REGROW_INTERVAL, WAIT_TICKS, WORK_RADIUS, WORK_TICKS,
} from './balance';
import { flowConsume, flowEdge, flowProduce, flowStarve, rollFlowWindow } from './flow';
import { findPath } from './path';
import {
  C as CELLS, NODE_STONE, NODE_TREE, T as TILES, TPC, cellOfTile, getSectorRt, nodeTile, refreshCellStage,
  type SectorRt, type SimWorld,
} from './world';
import { spawnNpc } from './npcs';

// Фази NPC
const PLAN = 0, WALK_NODE = 1, WORK_NODE = 2, WALK_DEPOSIT = 3, WALK_TAKE = 4, WALK_MILL = 5, WORK_MILL = 6, WAIT = 7;
const T = (n: (typeof TASKS)[number]) => TASKS.indexOf(n);
const WOOD = RESOURCE_KINDS.indexOf('wood'), STONE = RESOURCE_KINDS.indexOf('stone'), PLANKS = RESOURCE_KINDS.indexOf('planks');
const SAWYER = PROFESSIONS.indexOf('sawyer'), MINER = PROFESSIONS.indexOf('miner');

const isStorage = (b: BuildingState) => b.kind === 'townhall' || b.kind === 'warehouse';
const stockOf = (b: BuildingState, k: ResourceKind) => b.stock[k] ?? 0;

const capOf = (b: BuildingState, k: ResourceKind): number =>
  isStorage(b) ? (STORAGE_CAP[b.kind] ?? 0) : b.kind === 'sawmill' && k === 'wood' ? MILL_BUFFER : 0;

/** Найближче сховище свого гравця в секторі, що має запас (needStock) — для забору. */
function nearestStorage(rt: SectorRt, owner: string, x: number, y: number, kind: ResourceKind, needStock: number): BuildingState | null {
  let best: BuildingState | null = null, bd = Infinity;
  for (const b of rt.buildings) {
    if (!isStorage(b) || b.owner !== owner || b.progress < 1 || stockOf(b, kind) < needStock) continue;
    const d = Math.abs(b.entrance.x - x) + Math.abs(b.entrance.y - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/**
 * Куди віднести ресурс: найближча будівля, що його приймає й має вільне місце — споживач
 * (лісопильня з буфером колод) або склад. При рівній відстані споживач має перевагу.
 */
/** Дерево на складах гравця в секторі. */
function storageWood(rt: SectorRt, owner: string): number {
  let t = 0;
  for (const b of rt.buildings) if (isStorage(b) && b.owner === owner) t += stockOf(b, 'wood');
  return t;
}

function nearestAcceptor(rt: SectorRt, owner: string, x: number, y: number, kind: ResourceKind): BuildingState | null {
  let best: BuildingState | null = null, bd = Infinity;
  const reserveOk = kind !== 'wood' || storageWood(rt, owner) >= WOOD_RESERVE;
  for (const b of rt.buildings) {
    if (b.owner !== owner || b.progress < 1 || stockOf(b, kind) >= capOf(b, kind)) continue;
    // Переробка після будівництва: на паузі або при дефіциті дерева на складі колоди їй не несуть.
    if (!isStorage(b) && (b.paused || !reserveOk)) continue;
    if (!isStorage(b) && b.workers.length === 0) continue;
    const d = Math.abs(b.entrance.x - x) + Math.abs(b.entrance.y - y) - (isStorage(b) ? 0 : 0.5);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Видимість між двома точками (у тайлах) за footprint будівель, із запасом ±1 тайл; кінці (3 тайли) не перевіряються. */
function visible(rt: SectorRt, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / 2);
  const occ = rt.occ;
  for (let k = 1; k < steps; k++) {
    const f = k / steps;
    if (len * f < 3 || len * (1 - f) < 3) continue;
    const tx = Math.floor(x0 + dx * f), ty = Math.floor(y0 + dy * f);
    const i = ty * TILES + tx;
    if (occ[i] || occ[i - 1] || occ[i + 1] || occ[i - TILES] || occ[i + TILES]) return false;
  }
  return true;
}

const LOOKAHEAD = 8;
/**
 * Шлях до тайла (gx,gy): A* по грубих клітинках навігації, далі спрощення за видимістю
 * (прямі відрізки в тайлах). Один раз на подорож. Шлях зберігається як пари (x,y) у тайлах.
 */
function setPath(w: SimWorld, i: number, rt: SectorRt, gx: number, gy: number): boolean {
  const n = w.state.npcs;
  const sx = n.x[i], sy = n.y[i];
  const sc = cellOfTile(Math.floor(sx), Math.floor(sy)), gc = cellOfTile(gx, gy);
  const cells = findPath(rt, sc % CELLS, (sc / CELLS) | 0, gc % CELLS, (gc / CELLS) | 0);
  w.npc.pathPos[i] = 0;
  if (!cells) { w.npc.path[i] = null; return false; }
  const m = cells.length;
  const px: number[] = [sx], py: number[] = [sy];
  for (let k = 0; k < m - 1; k++) { px.push((cells[k] % CELLS) * TPC + TPC / 2); py.push(Math.floor(cells[k] / CELLS) * TPC + TPC / 2); }
  px.push(gx + 0.5); py.push(gy + 0.5);
  const out: number[] = [];
  const last = px.length - 1;
  let a = 0;
  while (a < last) {
    let b = Math.min(last, a + LOOKAHEAD);
    while (b > a + 1 && !visible(rt, px[a], py[a], px[b], py[b])) b--;
    out.push(px[b], py[b]);
    a = b;
  }
  w.npc.path[i] = Float32Array.from(out);
  w.npc.tile[i] = Math.floor(sy) * TILES + Math.floor(sx);
  return true;
}

/** Крок уздовж шляху; true — дійшов. Трафік стежки додається при вході в новий ТАЙЛ. */
function advance(w: SimWorld, i: number, rt: SectorRt): boolean {
  const n = w.state.npcs, path = w.npc.path[i];
  if (!path) return true;
  let pos = w.npc.pathPos[i];
  let x = n.x[i], y = n.y[i];
  let budget = NPC_SPEED * ROAD_SPEED_MULT[rt.stage[Math.floor(y) * TILES + Math.floor(x)] as TrailStage];
  while (pos < path.length && budget > 0) {
    const tx = path[pos], ty = path[pos + 1];
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
    const step = Math.min(budget, 0.5); // півтайла: не пропускаємо тайли на діагоналях
    if (d <= step) { x = tx; y = ty; budget -= d; pos += 2; } else { x += (dx / d) * step; y += (dy / d) * step; budget -= step; }
    const t = Math.floor(y) * TILES + Math.floor(x);
    if (t !== w.npc.tile[i]) { w.npc.tile[i] = t; stepOn(w, rt, t); }
  }
  n.x[i] = x; n.y[i] = y; w.npc.pathPos[i] = pos;
  if (pos >= path.length) { w.npc.path[i] = null; return true; }
  return false;
}

function stepOn(w: SimWorld, rt: SectorRt, t: number): void {
  const tr = rt.trails.traffic;
  tr[t] = Math.min(TRAIL_MAX, tr[t] + TRAIL_STEP_ADD);
  const ns = stageFromTraffic(tr[t], rt.stage[t]);
  if (ns !== rt.stage[t]) {
    rt.stage[t] = ns;
    refreshCellStage(rt, cellOfTile(t % TILES, (t / TILES) | 0));
    w.stageChanges.push({ sector: rt.id, cell: t, stage: ns });
  }
}

/** Найближча клітинка з вузлом даного виду (пошук кільцями навколо входу, радіус у клітинках). */
function findNode(rt: SectorRt, b: BuildingState, kind: number): number {
  const ex = Math.floor(b.entrance.x / TPC), ey = Math.floor(b.entrance.y / TPC);
  for (let r = 1; r <= WORK_RADIUS; r++) {
    let best = -1, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const y = ey + dy;
      if (y < 0 || y >= CELLS) continue;
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        const x = ex + dx;
        if (x < 0 || x >= CELLS) continue;
        const i = y * CELLS + x;
        if (rt.kind[i] === kind) {
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Час дії: дорога прискорює; багатство сектора (richness) = щедрість, тобто швидкість видобутку. */
const workTicks = (b: BuildingState, base: number, richness = 0.5) =>
  Math.max(1, Math.round((b.roadAttached ? base * ATTACHED_WORK_MULT : base) / (0.6 + 0.8 * richness)));
const richOf = (w: SimWorld, b: BuildingState, prof: number) =>
  w.state.sectors[b.sector].richness[prof === MINER ? 'stone' : 'wood'] ?? 0.5;

function wait(w: SimWorld, i: number, b: BuildingState, reason: string, starve = true): void {
  w.why.set(b.id, reason);
  w.npc.phase[i] = WAIT; w.npc.timer[i] = WAIT_TICKS;
  w.state.npcs.task[i] = T('rest');
  w.npc.path[i] = null;
  if (starve) flowStarve(w, b.id);
}

function planDeposit(w: SimWorld, i: number, rt: SectorRt, b: BuildingState): void {
  const n = w.state.npcs, kind = RESOURCE_KINDS[n.carryKind[i]];
  const st = nearestAcceptor(rt, b.owner, n.x[i], n.y[i], kind);
  if (!st) return wait(w, i, b, 'no_storage');
  if (!setPath(w, i, rt, st.entrance.x, st.entrance.y)) return wait(w, i, b, 'no_path');
  n.targetBuilding[i] = st.id;
  w.npc.phase[i] = WALK_DEPOSIT; n.task[i] = T('carry');
}

function plan(w: SimWorld, i: number, rt: SectorRt, b: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  if (n.profession[i] === SAWYER) return planSawyer(w, i, rt, b);
  if (n.carryAmount[i] > 0) return planDeposit(w, i, rt, b);
  const nodeKind = n.profession[i] === MINER ? NODE_STONE : NODE_TREE;
  const cell = findNode(rt, b, nodeKind);
  if (cell < 0) return wait(w, i, b, 'no_node');
  const nt = nodeTile(w.state.world.seed, rt.id, cell % CELLS, (cell / CELLS) | 0);
  if (!setPath(w, i, rt, nt.x, nt.y)) return wait(w, i, b, 'no_path');
  npc.aux[i] = cell; npc.phase[i] = WALK_NODE; n.task[i] = T('walk');
}

function planSawyer(w: SimWorld, i: number, rt: SectorRt, mill: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  const carry = n.carryAmount[i] > 0 ? n.carryKind[i] : -1;
  if (carry === PLANKS) return planDeposit(w, i, rt, mill);
  if (mill.paused && carry < 0 && stockOf(mill, 'planks') === 0) return wait(w, i, mill, 'paused', false);
  if (carry === WOOD || stockOf(mill, 'wood') >= 2 || stockOf(mill, 'planks') > 0) {
    if (!setPath(w, i, rt, mill.entrance.x, mill.entrance.y)) return wait(w, i, mill, 'no_path');
    npc.phase[i] = WALK_MILL; n.task[i] = T('walk');
    return;
  }
  const st = nearestStorage(rt, mill.owner, n.x[i], n.y[i], 'wood', 2 + WOOD_RESERVE);
  if (!st) return wait(w, i, mill, 'no_wood');
  if (!setPath(w, i, rt, st.entrance.x, st.entrance.y)) return wait(w, i, mill, 'no_path');
  n.targetBuilding[i] = st.id;
  npc.phase[i] = WALK_TAKE; n.task[i] = T('walk');
}

function stepNpc(w: SimWorld, i: number): void {
  const n = w.state.npcs, npc = w.npc;
  const wp = npc.workplace[i];
  const b = wp >= 0 ? w.byId.get(wp) : undefined;
  if (!b) { npc.workplace[i] = -1; n.task[i] = T('idle'); npc.path[i] = null; return; }
  const rt = getSectorRt(w, b.sector);
  switch (npc.phase[i]) {
    case PLAN: plan(w, i, rt, b); break;
    case WAIT: if (--npc.timer[i] <= 0) npc.phase[i] = PLAN; break;
    case WALK_NODE: {
      if (!advance(w, i, rt)) break;
      const c = npc.aux[i], nodeKind = n.profession[i] === MINER ? NODE_STONE : NODE_TREE;
      if (rt.kind[c] !== nodeKind) { npc.phase[i] = PLAN; break; }
      npc.phase[i] = WORK_NODE; npc.timer[i] = workTicks(b, WORK_TICKS, richOf(w, b, n.profession[i])); n.task[i] = T('work');
      break;
    }
    case WORK_NODE: {
      if (--npc.timer[i] > 0) break;
      const c = npc.aux[i], isStone = n.profession[i] === MINER;
      {
        // Ресурс безкінечний: вузол лише «зрубується» візуально й відновлюється (regrow).
        rt.amount[c] = 0; rt.forest[c] = 0;
        n.carryKind[i] = isStone ? STONE : WOOD; n.carryAmount[i]++;
        const k = RESOURCE_KINDS[n.carryKind[i]];
        w.why.delete(b.id);
        flowProduce(w, b.id, k, 1);
        flowEdge(w, 0, b.id, k, 1);
      }
      if (n.carryAmount[i] < CARRY_CAP) npc.timer[i] = workTicks(b, WORK_TICKS, richOf(w, b, n.profession[i]));
      else npc.phase[i] = PLAN;
      break;
    }
    case WALK_DEPOSIT: {
      if (!advance(w, i, rt)) break;
      const st = w.byId.get(n.targetBuilding[i]);
      const k = RESOURCE_KINDS[n.carryKind[i]];
      if (st) {
        const put = Math.min(n.carryAmount[i], capOf(st, k) - stockOf(st, k));
        if (put > 0) {
          st.stock[k] = stockOf(st, k) + put;
          n.carryAmount[i] -= put;
          flowEdge(w, b.id, st.id, k, put);
        }
      }
      if (n.carryAmount[i] === 0) { n.carryKind[i] = 255; npc.phase[i] = PLAN; } else wait(w, i, b, 'storage_full');
      break;
    }
    case WALK_TAKE: {
      if (!advance(w, i, rt)) break;
      const st = w.byId.get(n.targetBuilding[i]);
      const have = st ? stockOf(st, 'wood') : 0;
      const usable = have - WOOD_RESERVE; // решта — резерв під будівництво
      if (!st || usable < 2 || b.paused) { npc.phase[i] = PLAN; wait(w, i, b, b.paused ? 'paused' : 'no_wood'); break; }
      const take = Math.min(Math.max(2, MILL_BUFFER - stockOf(b, 'wood')), usable);
      st.stock.wood = have - take;
      n.carryKind[i] = WOOD; n.carryAmount[i] = take;
      npc.aux[i] = st.id;
      npc.phase[i] = PLAN;
      break;
    }
    case WALK_MILL: {
      if (!advance(w, i, rt)) break;
      if (n.carryAmount[i] > 0 && n.carryKind[i] === WOOD) {
        b.stock.wood = stockOf(b, 'wood') + n.carryAmount[i];
        if (npc.aux[i] >= 0) flowEdge(w, npc.aux[i], b.id, 'wood', n.carryAmount[i]);
        n.carryAmount[i] = 0; n.carryKind[i] = 255; npc.aux[i] = -1;
      }
      startMill(w, i, b);
      break;
    }
    case WORK_MILL: {
      if (--npc.timer[i] > 0) break;
      if (stockOf(b, 'wood') >= 2) {
        b.stock.wood = stockOf(b, 'wood') - 2; b.stock.planks = stockOf(b, 'planks') + 1;
        w.why.delete(b.id); flowConsume(w, b.id, 'wood', 2); flowProduce(w, b.id, 'planks', 1);
      }
      startMill(w, i, b);
      break;
    }
  }
}

function startMill(w: SimWorld, i: number, mill: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  if (!mill.paused && stockOf(mill, 'wood') >= 2) {
    npc.phase[i] = WORK_MILL; npc.timer[i] = workTicks(mill, MILL_TICKS); n.task[i] = T('work');
    return;
  }
  const planks = stockOf(mill, 'planks');
  if (planks > 0) {
    const take = Math.min(planks, 200);
    mill.stock.planks = planks - take;
    n.carryKind[i] = PLANKS; n.carryAmount[i] = take;
  }
  npc.phase[i] = PLAN;
}

/** Будівля прикріплена до дороги, якщо в межах 2 тайлів від входу є тайл стадії ≥ Road. */
function updateRoadAttached(w: SimWorld): void {
  for (const b of w.state.buildings) {
    const rt = w.sectors.get(b.sector);
    if (!rt) continue;
    let ok = false;
    for (let dy = -2; dy <= 2 && !ok; dy++) {
      for (let dx = -2; dx <= 2 && !ok; dx++) {
        const x = b.entrance.x + dx, y = b.entrance.y + dy;
        if (x >= 0 && y >= 0 && x < TILES && y < TILES && rt.stage[y * TILES + x] >= ROAD_ATTACH_MIN_STAGE) ok = true;
      }
    }
    b.roadAttached = ok;
  }
}

function decayTrails(w: SimWorld): void {
  for (const rt of w.sectors.values()) {
    const t = rt.trails.traffic;
    for (let c = 0; c < t.length; c++) {
      if (!t[c]) continue;
      t[c] = Math.floor(t[c] * TRAIL_DECAY_FACTOR);
      const ns = stageFromTraffic(t[c], rt.stage[c]);
      if (ns !== rt.stage[c]) {
        rt.stage[c] = ns;
        refreshCellStage(rt, cellOfTile(c % TILES, (c / TILES) | 0));
        w.stageChanges.push({ sector: rt.id, cell: c, stage: ns });
      }
    }
  }
}

function regrow(w: SimWorld): void {
  for (const rt of w.sectors.values()) {
    for (let c = 0; c < rt.kind.length; c++) {
      if (rt.kind[c] && rt.amount[c] === 0) {
        rt.amount[c] = rt.kind[c] === NODE_TREE ? TREE_AMOUNT : STONE_AMOUNT;
        if (rt.kind[c] === NODE_TREE) rt.forest[c] = 1;
      }
    }
  }
}

function houses(w: SimWorld): void {
  const t = w.state.tick;
  for (const b of w.state.buildings) {
    if (b.kind !== 'house' || b.progress < 1 || (t / 10 + b.id) % (HOUSE_SPAWN_INTERVAL / 10) !== 0) continue;
    const pi = w.state.players.findIndex((p) => p.id === b.owner);
    const pop = countPop(w, pi);
    const homes = w.state.buildings.filter((x) => x.kind === 'house' && x.owner === b.owner).length;
    if (pop >= POP_BASE + POP_PER_HOUSE * homes) continue;
    spawnNpc(w, pi, b.sector, b.entrance.x, b.entrance.y);
  }
}

export function countPop(w: SimWorld, playerIdx: number): number {
  const n = w.state.npcs;
  let c = 0;
  for (let i = 0; i < n.capacity; i++) if (n.alive[i] && n.owner[i] === playerIdx) c++;
  return c;
}

/** Підсумок запасів гравців = сума запасів його сховищ. */
export function syncPlayerResources(w: SimWorld): void {
  for (const p of w.state.players) for (const k of RESOURCE_KINDS) p.resources[k] = 0;
  for (const b of w.state.buildings) {
    if (!isStorage(b)) continue;
    const p = w.state.players.find((x) => x.id === b.owner);
    if (p) for (const [k, v] of Object.entries(b.stock)) p.resources[k as ResourceKind] += v ?? 0;
  }
}

/** Один тік економіки. Повертає події тіка (також лежать у w.events до наступного виклику). */
export function stepWorld(w: SimWorld): void {
  const s = w.state, n = s.npcs;
  w.events = [];
  w.stageChanges.length = 0;
  s.tick++;
  const cap = n.capacity;
  for (let i = 0; i < cap; i++) if (n.alive[i]) stepNpc(w, i);
  if (s.tick % TRAIL_DECAY_INTERVAL === 0) decayTrails(w);
  if (s.tick % ROAD_CHECK_INTERVAL === 0) updateRoadAttached(w);
  if (s.tick % TREE_REGROW_INTERVAL === 0) regrow(w);
  if (s.tick % 10 === 0) { syncPlayerResources(w); houses(w); }
  rollFlowWindow(w);
  if (w.stageChanges.length) {
    const groups = new Map<number, { sector: number; stage: number; cells: number[] }>();
    for (const c of w.stageChanges) {
      const key = c.sector * 4 + c.stage;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { sector: c.sector, stage: c.stage, cells: [] }));
      g.cells.push(c.cell);
    }
    for (const g of groups.values()) w.events.push({ e: 'trail_stage_changed', ...g });
  }
}
