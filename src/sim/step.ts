import type { BuildingState, ResourceKind } from '../shared';
import {
  PROFESSIONS, RESOURCE_KINDS, ROAD_ATTACH_MIN_STAGE, ROAD_SPEED_MULT, TASKS,
  TRAIL_DECAY_INTERVAL, TRAIL_MAX, TRAIL_STEP_ADD, TrailStage, stageFromTraffic,
} from '../shared';
import {
  ATTACHED_WORK_MULT, CARRIER_CAP, CARRY_CAP, PROCESS_TICKS, HOUSE_SPAWN_INTERVAL, MILL_BUFFER, MILL_TICKS, WOOD_RESERVE, NPC_SPEED, POP_BASE, POP_PER_HOUSE,
  ROAD_CHECK_INTERVAL, TRAIL_DECAY_BY_STAGE, STONE_AMOUNT, STONE_REGROW_INTERVAL, STORAGE_CAP, TREE_AMOUNT, TREE_CHOP_TICKS, TREE_GROWTH, TREE_GROW_STEP, TREE_STAGE_TICKS, WAIT_TICKS, WORK_RADIUS, WORK_TICKS,
} from './balance';
import { flowConsume, flowEdge, flowProduce, flowStarve, rollFlowWindow } from './flow';
import { planRoute, sizeClassOf } from './route';
import {
  shoreNear, C as CELLS, NODE_STONE, NODE_TREE, T as TILES, TPC, cellOfTile, getSectorRt, nodeTile, refreshCellStage,
  type SectorRt, type SimWorld,
} from './world';
import { autoStaffIdle } from './assign';
import { hash2 } from './rng';
import { FLOW_PEOPLE, NPC_STAT_COUNT, statIndex } from '../shared';
import { FISH_SHORE_RADIUS, FISH_TICKS } from './balance';
import { EAT_BELOW, FARM_CARRY, FARM_TICKS, FOOD_RESTORE, FULL_MAX, HUNGER_INTERVAL, HUNGRY_BELOW, HUNGRY_MULT } from './balance';

const ST_WALK = statIndex('walk'), ST_CARRY = statIndex('carry'), ST_GATHER = statIndex('gather');
/** Множник NPC за статом (1 = норма). */
/** Ефективність від голоду: ситий 1, голодний HUNGRY_MULT (довше працює). */
const hungerEff = (w: SimWorld, i: number): number => (w.state.npcs.fullness[i] < HUNGRY_BELOW ? HUNGRY_MULT : 1);
const mul = (w: SimWorld, i: number, s: number): number => w.state.npcs.stats[i * NPC_STAT_COUNT + s] / 100;
import { spawnNpc } from './npcs';

// Фази NPC
export const PHASE = { PLAN: 0, WALK_NODE: 1, WORK_NODE: 2, WALK_DEPOSIT: 3, WALK_TAKE: 4, WALK_MILL: 5, WORK_MILL: 6, WAIT: 7, WALK_HOME: 8, WORK_HOME: 9, CARRY_PICK: 10, CARRY_DROP: 11, EAT: 12, FARM_WALK: 13, FARM_WORK: 14 } as const;
const { PLAN, WALK_NODE, WORK_NODE, WALK_DEPOSIT, WALK_TAKE, WALK_MILL, WORK_MILL, WAIT, WALK_HOME, WORK_HOME, CARRY_PICK, CARRY_DROP, EAT, FARM_WALK, FARM_WORK } = PHASE;
const T = (n: (typeof TASKS)[number]) => TASKS.indexOf(n);
const WOOD = RESOURCE_KINDS.indexOf('wood'), STONE = RESOURCE_KINDS.indexOf('stone'), PLANKS = RESOURCE_KINDS.indexOf('planks');
const HUNTER = PROFESSIONS.indexOf('hunter'), FISHER = PROFESSIONS.indexOf('fisher'), FARMER = PROFESSIONS.indexOf('farmer'), FOOD = RESOURCE_KINDS.indexOf('food');
const CARRIER = PROFESSIONS.indexOf('carrier'), SAWYER = PROFESSIONS.indexOf('sawyer'), MINER = PROFESSIONS.indexOf('miner');

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

/**
 * Шлях до тайла (gx,gy): маршрут за розміром NPC (planRoute: грубий A* + прямі за тайловою прохідністю).
 * Один раз на подорож. Шлях зберігається як пари (x,y) у тайлах.
 */
function setPath(w: SimWorld, i: number, rt: SectorRt, gx: number, gy: number): boolean {
  const n = w.state.npcs;
  const sx = n.x[i], sy = n.y[i];
  w.npc.pathPos[i] = 0;
  const out = planRoute(rt, sizeClassOf(w, i), sx, sy, gx, gy);
  if (!out) { w.npc.path[i] = null; return false; }
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
  let budget = NPC_SPEED * mul(w, i, ST_WALK) * ROAD_SPEED_MULT[rt.stage[Math.floor(y) * TILES + Math.floor(x)] as TrailStage];
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

export function stepOn(w: SimWorld, rt: SectorRt, t: number): void {
  const tr = rt.trails.traffic;
  tr[t] = Math.min(TRAIL_MAX, tr[t] + TRAIL_STEP_ADD);
  const ns = stageFromTraffic(tr[t], rt.stage[t]);
  if (ns !== rt.stage[t]) {
    rt.stage[t] = ns;
    refreshCellStage(rt, cellOfTile(t % TILES, (t / TILES) | 0));
    w.stageChanges.push({ sector: rt.id, cell: t, stage: ns });
  }
}

/** Вузол уже обраний іншим живим NPC, який до нього йде або на ньому працює. */
function claimedByOther(w: SimWorld, rt: SectorRt, cell: number, me: number): boolean {
  const o = rt.claimBy[cell] - 1;
  return o >= 0 && o !== me && w.state.npcs.alive[o] === 1 && w.npc.aux[o] === cell &&
    (w.npc.phase[o] === WALK_NODE || w.npc.phase[o] === WORK_NODE);
}

/**
 * Найближча клітинка з вузлом даного виду (кільцями навколо входу, радіус у клітинках).
 * Віддаємо перевагу вузлам, які ніхто не обрав, щоб працівники не стовпились на одному дереві.
 */
function findNode(w: SimWorld, i: number, rt: SectorRt, b: BuildingState, kind: number): number {
  const ex = Math.floor(b.entrance.x / TPC), ey = Math.floor(b.entrance.y / TPC);
  let fallback = -1, fallbackR = 0;
  for (let r = 1; r <= WORK_RADIUS; r++) {
    if (fallback >= 0 && r > fallbackR + 6) break;
    let best = -1, bd = Infinity, bestAny = -1, bad = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const y = ey + dy;
      if (y < 0 || y >= CELLS) continue;
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        const x = ex + dx;
        if (x < 0 || x >= CELLS) continue;
        const c = y * CELLS + x;
        if (rt.kind[c] !== kind || (kind === NODE_TREE && rt.amount[c] < TREE_AMOUNT)) continue; // рубаємо лише доросле дерево
        const d = dx * dx + dy * dy;
        if (d < bad) { bad = d; bestAny = c; }
        if (d < bd && !claimedByOther(w, rt, c, i)) { bd = d; best = c; }
      }
    }
    if (best >= 0) return best;
    if (fallback < 0 && bestAny >= 0) { fallback = bestAny; fallbackR = r; }
  }
  return fallback;
}

/** Точка біля входу будівлі: у кожного NPC своя (детермінований зсув), щоб не стояли в одному тайлі. */
function spotNear(rt: SectorRt, b: BuildingState, i: number): { x: number; y: number } {
  const h1 = hash2(i, b.id, 7), h2 = hash2(b.id, i, 11);
  const x = Math.min(TILES - 1, Math.max(0, b.entrance.x + Math.floor(h1 * 9) - 4));
  const y = Math.min(TILES - 1, b.entrance.y + Math.floor(h2 * 5));
  return rt.occ[y * TILES + x] ? { x: b.entrance.x, y: b.entrance.y } : { x, y };
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
  { const sp = spotNear(rt, st, i); if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, b, 'no_path'); }
  n.targetBuilding[i] = st.id;
  w.npc.phase[i] = WALK_DEPOSIT; n.task[i] = T('carry');
}

function plan(w: SimWorld, i: number, rt: SectorRt, b: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  if (n.fullness[i] < EAT_BELOW && planEat(w, i, rt, b)) return;
  if (n.profession[i] === FARMER || n.profession[i] === FISHER) return planFarmer(w, i, rt, b);
  if (n.profession[i] === CARRIER) return planCarrier(w, i, rt, b);
  if (n.profession[i] === SAWYER) return planSawyer(w, i, rt, b);
  if (n.carryAmount[i] > 0 && npc.stage[i] === 1) return planDeposit(w, i, rt, b); // оброблене -> споживач/склад
  if (n.carryAmount[i] >= Math.max(1, Math.round(CARRY_CAP * mul(w, i, ST_CARRY)))) { // набрали рейс: спершу до своєї хатинки на обробку
    const sp = spotNear(rt, b, i);
    if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, b, 'no_path');
    npc.phase[i] = WALK_HOME; n.task[i] = T('carry');
    return;
  }
  const nodeKind = n.profession[i] === MINER ? NODE_STONE : NODE_TREE;
  const cell = findNode(w, i, rt, b, nodeKind);
  if (cell < 0) return wait(w, i, b, 'no_node');
  const nt = nodeTile(w.state.world.seed, rt.id, cell % CELLS, (cell / CELLS) | 0);
  if (!setPath(w, i, rt, nt.x, nt.y)) return wait(w, i, b, 'no_path');
  npc.aux[i] = cell; rt.claimBy[cell] = i + 1; npc.phase[i] = WALK_NODE; n.task[i] = T('walk');
}

/** Виробники їжі працюють і на нулі ситості (повільніше), щоб не було глухого кута. */
const isFoodJob = (p: number): boolean => p === FARMER || p === HUNTER || p === FISHER;

/** Голодний NPC йде до найближчого складу з їжею. true — дію вибрано (іти їсти або чекати), false — планувати звичайно. */
function planEat(w: SimWorld, i: number, rt: SectorRt, b: BuildingState): boolean {
  const n = w.state.npcs;
  const st = nearestStorage(rt, b.owner, n.x[i], n.y[i], 'food', 1);
  if (st) {
    const sp = spotNear(rt, st, i);
    if (!setPath(w, i, rt, sp.x, sp.y)) return false;
    n.targetBuilding[i] = st.id; w.npc.phase[i] = EAT; n.task[i] = T('walk');
    return true;
  }
  if (n.fullness[i] === 0 && !isFoodJob(n.profession[i])) { wait(w, i, b, 'no_food'); return true; }
  return false;
}

/** Фермер: іде до ферми, працює на полі (1 од. їжі за FARM_TICKS), набравши FARM_CARRY — несе до найближчого приймача. */
function planFarmer(w: SimWorld, i: number, rt: SectorRt, farm: BuildingState): void {
  const n = w.state.npcs;
  if (n.carryAmount[i] >= FARM_CARRY) return planDeposit(w, i, rt, farm);
  let sp = spotNear(rt, farm, i);
  if (n.profession[i] === FISHER) { // риба: стоїмо на березі
    const sh = shoreNear(w, rt.id, farm.entrance.x, farm.entrance.y, FISH_SHORE_RADIUS + 4);
    if (!sh) return wait(w, i, farm, 'no_water');
    sp = { x: sh.x, y: sh.y };
  }
  if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, farm, 'no_path');
  w.npc.phase[i] = FARM_WALK; n.task[i] = T('walk');
}

/** Найбільший запас у будівлі (вид ресурсу) або -1. */
function biggestStock(b: BuildingState): number {
  let best = -1, bv = 0;
  RESOURCE_KINDS.forEach((k, idx) => { const v = stockOf(b, k); if (v > bv) { bv = v; best = idx; } });
  return best;
}

/** Носій підскладу: бере запас підскладу (до CARRIER_CAP) -> несе в найближчу ратушу -> назад. */
function planCarrier(w: SimWorld, i: number, rt: SectorRt, wh: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  if (n.carryAmount[i] > 0) {
    let hall: BuildingState | null = null, bd = Infinity;
    for (const b of rt.buildings) {
      if (b.kind !== 'townhall' || b.owner !== wh.owner || b.progress < 1) continue;
      const d = Math.abs(b.entrance.x - n.x[i]) + Math.abs(b.entrance.y - n.y[i]);
      if (d < bd) { bd = d; hall = b; }
    }
    if (!hall) return wait(w, i, wh, 'no_storage');
    const sp = spotNear(rt, hall, i);
    if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, wh, 'no_path');
    n.targetBuilding[i] = hall.id; npc.phase[i] = CARRY_DROP; n.task[i] = T('carry');
    return;
  }
  if (biggestStock(wh) < 0) return wait(w, i, wh, 'no_stock', false);
  const sp = spotNear(rt, wh, i);
  if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, wh, 'no_path');
  npc.phase[i] = CARRY_PICK; n.task[i] = T('walk');
}

function planSawyer(w: SimWorld, i: number, rt: SectorRt, mill: BuildingState): void {
  const n = w.state.npcs, npc = w.npc;
  const carry = n.carryAmount[i] > 0 ? n.carryKind[i] : -1;
  if (carry === PLANKS) return planDeposit(w, i, rt, mill);
  if (mill.paused && carry < 0 && stockOf(mill, 'planks') === 0) return wait(w, i, mill, 'paused', false);
  if (carry === WOOD || stockOf(mill, 'wood') >= 2 || stockOf(mill, 'planks') > 0) {
    { const sp = spotNear(rt, mill, i); if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, mill, 'no_path'); }
    npc.phase[i] = WALK_MILL; n.task[i] = T('walk');
    return;
  }
  const st = nearestStorage(rt, mill.owner, n.x[i], n.y[i], 'wood', 2 + WOOD_RESERVE);
  if (!st) return wait(w, i, mill, 'no_wood');
  { const sp = spotNear(rt, st, i); if (!setPath(w, i, rt, sp.x, sp.y)) return wait(w, i, mill, 'no_path'); }
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
      if (rt.kind[c] !== nodeKind || (nodeKind === NODE_TREE && rt.amount[c] < TREE_AMOUNT)) { npc.phase[i] = PLAN; break; }
      npc.phase[i] = WORK_NODE; npc.timer[i] = Math.max(1, Math.round(workTicks(b, n.profession[i] === MINER ? WORK_TICKS : TREE_CHOP_TICKS, richOf(w, b, n.profession[i])) / (mul(w, i, ST_GATHER) * hungerEff(w, i)))); n.task[i] = T('work');
      break;
    }
    case WORK_NODE: {
      if (--npc.timer[i] > 0) break;
      const c = npc.aux[i], isStone = n.profession[i] === MINER, isGame = n.profession[i] === HUNTER; // мисливець добуває дичину (їжу) в лісі
      // Ресурс безкінечний: вузол лише «зрубується» (пеньок) й відростає стадіями (growTrees). По одній колоді за візит.
      if (rt.amount[c] === 0) { npc.phase[i] = PLAN; break; } // хтось уже зрубав
      if (!isStone && !isGame) w.events.push({ e: 'tree_felled', sector: rt.id, cell: c, fx: n.x[i], fy: n.y[i] });
      rt.amount[c] = 0; rt.forest[c] = 0;
      n.carryKind[i] = isStone ? STONE : isGame ? FOOD : WOOD; n.carryAmount[i]++; npc.stage[i] = 0;
      flowEdge(w, 0, b.id, RESOURCE_KINDS[n.carryKind[i]], 1);
      npc.phase[i] = PLAN;
      break;
    }
    case WALK_HOME: {
      if (!advance(w, i, rt)) break;
      npc.phase[i] = WORK_HOME; npc.timer[i] = Math.round(workTicks(b, PROCESS_TICKS, richOf(w, b, n.profession[i])) / hungerEff(w, i)); n.task[i] = T('work');
      break;
    }
    case WORK_HOME: {
      if (--npc.timer[i] > 0) break;
      w.why.delete(b.id);
      flowProduce(w, b.id, RESOURCE_KINDS[n.carryKind[i]], n.carryAmount[i]); // оброблене виробляється тут
      npc.stage[i] = 1; npc.phase[i] = PLAN;
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
      if (n.carryAmount[i] === 0) { n.carryKind[i] = 255; npc.stage[i] = 0; npc.phase[i] = PLAN; } else wait(w, i, b, 'storage_full');
      break;
    }
    case EAT: {
      if (!advance(w, i, rt)) break;
      const st = w.byId.get(n.targetBuilding[i]);
      if (st && stockOf(st, 'food') >= 1) {
        st.stock.food = stockOf(st, 'food') - 1;
        n.fullness[i] = Math.min(FULL_MAX, n.fullness[i] + FOOD_RESTORE);
        flowConsume(w, st.id, 'food', 1); flowEdge(w, st.id, FLOW_PEOPLE, 'food', 1);
      }
      npc.phase[i] = PLAN;
      break;
    }
    case FARM_WALK: {
      if (!advance(w, i, rt)) break;
      npc.phase[i] = FARM_WORK; n.task[i] = T('work');
      npc.timer[i] = Math.max(1, Math.round(workTicks(b, b.kind === 'fisher' ? FISH_TICKS : FARM_TICKS) / (mul(w, i, ST_GATHER) * hungerEff(w, i))));
      break;
    }
    case FARM_WORK: {
      if (--npc.timer[i] > 0) break;
      w.why.delete(b.id);
      n.carryKind[i] = FOOD; n.carryAmount[i]++; npc.stage[i] = 0;
      flowProduce(w, b.id, 'food', 1); flowEdge(w, 0, b.id, 'food', 1);
      npc.phase[i] = PLAN;
      break;
    }
    case CARRY_PICK: {
      if (!advance(w, i, rt)) break;
      const k = biggestStock(b);
      if (k >= 0) {
        const kind = RESOURCE_KINDS[k];
        const take = Math.min(stockOf(b, kind), Math.max(1, Math.round(CARRIER_CAP * mul(w, i, ST_CARRY))));
        b.stock[kind] = stockOf(b, kind) - take;
        n.carryKind[i] = k; n.carryAmount[i] = take; npc.stage[i] = 0;
      }
      npc.phase[i] = PLAN;
      break;
    }
    case CARRY_DROP: {
      if (!advance(w, i, rt)) break;
      const hall = w.byId.get(n.targetBuilding[i]), k = RESOURCE_KINDS[n.carryKind[i]];
      if (hall) {
        const put = Math.min(n.carryAmount[i], capOf(hall, k) - stockOf(hall, k));
        if (put > 0) { hall.stock[k] = stockOf(hall, k) + put; n.carryAmount[i] -= put; flowEdge(w, b.id, hall.id, k, put); }
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
    npc.phase[i] = WORK_MILL; npc.timer[i] = Math.round(workTicks(mill, MILL_TICKS) / hungerEff(w, i)); n.task[i] = T('work');
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

/** Згасання на `steps` інтервалів одразу (звичайний тік = 1). Швидкість залежить від стадії тайла (TRAIL_DECAY_BY_STAGE). */
export function decayTrails(w: SimWorld, steps = 1): void {
  const keep = TRAIL_DECAY_BY_STAGE.map((r) => Math.pow(1 - r, steps));
  for (const rt of w.sectors.values()) {
    const t = rt.trails.traffic;
    for (let c = 0; c < t.length; c++) {
      if (!t[c]) continue;
      // Випадкове (детерміноване) округлення: слабкий трафік згасає повільно, а не зникає за один крок.
      t[c] = Math.floor(t[c] * keep[rt.stage[c]] + hash2(c, w.state.tick, 9));
      const ns = stageFromTraffic(t[c], rt.stage[c]);
      if (ns !== rt.stage[c]) {
        rt.stage[c] = ns;
        refreshCellStage(rt, cellOfTile(c % TILES, (c / TILES) | 0));
        w.stageChanges.push({ sector: rt.id, cell: c, stage: ns });
      }
    }
  }
}

/** Ріст дерев: кожне зрубане/молоде дерево раз на TREE_STAGE_TICKS/mult тіків (у власній фазі) піднімається на стадію. Каміння відновлюється як було. */
export function growTrees(w: SimWorld): void {
  const interval = Math.max(TREE_GROW_STEP, Math.round(TREE_STAGE_TICKS / Math.max(0.01, TREE_GROWTH.mult))), tick = w.state.tick;
  for (const rt of w.sectors.values()) {
    for (let c = 0; c < rt.kind.length; c++) {
      if (rt.kind[c] !== NODE_TREE || rt.amount[c] >= TREE_AMOUNT) continue;
      const off = Math.floor(hash2(c, rt.id, 77) * interval);
      if ((tick + off) % interval >= TREE_GROW_STEP) continue; // у цьому вікні стадія вже/ще не настала
      rt.amount[c]++;
      if (rt.amount[c] >= 2) rt.forest[c] = 1; // молоде дерево вже заважає йти
    }
  }
}

function regrowStone(w: SimWorld): void {
  for (const rt of w.sectors.values()) {
    for (let c = 0; c < rt.kind.length; c++) if (rt.kind[c] === NODE_STONE && rt.amount[c] === 0) rt.amount[c] = STONE_AMOUNT;
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
  w.npc.px.set(n.x); w.npc.py.set(n.y); // «попередня» позиція для інтерполяції в рендері
  s.tick++;
  const cap = n.capacity;
  for (let i = 0; i < cap; i++) if (n.alive[i]) stepNpc(w, i);
  if (s.tick % HUNGER_INTERVAL === 0) for (let i = 0; i < cap; i++) if (n.alive[i] && n.fullness[i] > 0) n.fullness[i]--;
  if (s.tick % TRAIL_DECAY_INTERVAL === 0) decayTrails(w);
  if (s.tick % ROAD_CHECK_INTERVAL === 0) updateRoadAttached(w);
  if (s.tick % TREE_GROW_STEP === 0) growTrees(w);
  if (s.tick % STONE_REGROW_INTERVAL === 0) regrowStone(w);
  if (s.tick % 10 === 0) { syncPlayerResources(w); houses(w); autoStaffIdle(w); }
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
