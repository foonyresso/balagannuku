import {
  ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, CAMP_PLAZA, NPC_STAT_COUNT, ROAD_SPEED_MULT, ROAM_RADIUS, TASKS, campSlotSpot, statIndex,
  type BuildingState, type Campfire, type TrailStage,
} from '../../shared';
import { NPC_SPEED } from '../balance';
import { hash2 } from '../rng';
import { planRoute, sizeClassOf } from '../route';
import { campfireFor } from '../systems/camp';
import { T as TILES, getSectorRt, type SectorRt, type SimWorld } from '../world';
import { PHASE } from './consts';

/** Вільний житель (без роботи): слотовий іде до свого місця біля вогнища й чекає, решта бродить біля споруд. */
const DECIDE = PHASE.PLAN, IDLE_WALK = PHASE.IDLE_WALK, IDLE_STAY = PHASE.IDLE_STAY;
const TASK_IDLE = TASKS.indexOf('idle'), TASK_WALK = TASKS.indexOf('walk');
const ST_WALK = statIndex('walk');

/** Крок уздовж шляху без сліду на дорозі (вільні гуляють, не втоптують стежки); true — дійшов. */
function walk(w: SimWorld, i: number, rt: SectorRt): boolean {
  const n = w.state.npcs, npc = w.npc, path = npc.path[i];
  if (!path) return true;
  let pos = npc.pathPos[i], x = n.x[i], y = n.y[i];
  let budget = NPC_SPEED * (n.stats[i * NPC_STAT_COUNT + ST_WALK] / 100) * ROAD_SPEED_MULT[rt.stage[Math.floor(y) * TILES + Math.floor(x)] as TrailStage];
  while (pos < path.length && budget > 0) {
    const tx = path[pos], ty = path[pos + 1], dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy), step = Math.min(budget, 0.5);
    if (d <= step) { x = tx; y = ty; budget -= d; pos += 2; } else { x += (dx / d) * step; y += (dy / d) * step; budget -= step; }
  }
  n.x[i] = x; n.y[i] = y; npc.pathPos[i] = pos;
  npc.tile[i] = Math.floor(y) * TILES + Math.floor(x);
  if (pos >= path.length) { npc.path[i] = null; return true; }
  return false;
}

function stay(w: SimWorld, i: number, ticks: number): void {
  w.npc.phase[i] = IDLE_STAY; w.npc.timer[i] = ticks; w.npc.path[i] = null; w.state.npcs.task[i] = TASK_IDLE;
}

/** Піти в (gx,gy); не вийшло (нема маршруту) — постояти. */
function goTo(w: SimWorld, i: number, rt: SectorRt, gx: number, gy: number): boolean {
  const n = w.state.npcs, npc = w.npc;
  const out = planRoute(rt, sizeClassOf(w, i), n.x[i], n.y[i], gx, gy);
  if (!out || !out.length) return false;
  npc.path[i] = Float32Array.from(out); npc.pathPos[i] = 0;
  npc.tile[i] = Math.floor(n.y[i]) * TILES + Math.floor(n.x[i]);
  npc.phase[i] = IDLE_WALK; n.task[i] = TASK_WALK;
  return true;
}

/** Найближча споруда гравця в секторі до точки (її вхід — центр бродіння). */
function nearestBuilding(rt: SectorRt, owner: string, x: number, y: number): BuildingState | null {
  let best: BuildingState | null = null, bd = Infinity;
  for (const b of rt.buildings) {
    if (b.owner !== owner) continue;
    const d = Math.abs(b.entrance.x - x) + Math.abs(b.entrance.y - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Точка бродіння: у радіусі ROAM_RADIUS від входу найближчої споруди, на вільному тайлі, не в зоні вогнища. */
export function roamTarget(i: number, rt: SectorRt, anchor: { x: number; y: number }, fire: Campfire | null, salt: number): { x: number; y: number } | null {
  for (let k = 0; k < 6; k++) {
    const a = hash2(i, salt, 31 + k) * Math.PI * 2, r = ROAM_RADIUS * Math.sqrt(hash2(salt, i, 47 + k));
    const x = Math.floor(anchor.x + Math.cos(a) * r), y = Math.floor(anchor.y + Math.sin(a) * r * 0.7);
    if (x < ACTIVE_MIN_TILE || y < ACTIVE_MIN_TILE || x >= ACTIVE_MAX_TILE - 1 || y >= ACTIVE_MAX_TILE - 1 || rt.occ[y * TILES + x]) continue;
    if (fire && Math.abs(x - fire.x) <= CAMP_PLAZA && Math.abs(y - fire.y) <= CAMP_PLAZA) continue;
    return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

/** Один тік вільного жителя: слотовий іде до свого місця біля вогнища й стоїть; решта бродить біля споруд. */
export function stepIdle(w: SimWorld, i: number): void {
  const n = w.state.npcs, npc = w.npc, tick = w.state.tick;
  switch (npc.phase[i]) {
    case IDLE_WALK: {
      if (walk(w, i, getSectorRt(w, n.sector[i]))) stay(w, i, 20 + Math.floor(hash2(i, tick, 61) * 80));
      return;
    }
    case IDLE_STAY: if (--npc.timer[i] <= 0) npc.phase[i] = DECIDE; return;
    case DECIDE: break;
    default: npc.phase[i] = DECIDE; npc.path[i] = null; // залишок робочої фази
  }
  const owner = w.state.players[n.owner[i]]?.id;
  if (!owner) return stay(w, i, 50);
  const rt = getSectorRt(w, n.sector[i]), fire = campfireFor(w, owner, n.sector[i]), slot = npc.camp[i];
  if (slot >= 0 && fire) {
    const s = campSlotSpot(fire, slot);
    if (Math.hypot(s.x - n.x[i], s.y - n.y[i]) < 0.8) return stay(w, i, 80 + Math.floor(hash2(i, tick, 67) * 120));
    if (!goTo(w, i, rt, s.x, s.y)) stay(w, i, 30);
    return;
  }
  const anchor = nearestBuilding(rt, owner, n.x[i], n.y[i]) ?? (fire ? { entrance: fire } : null);
  const t = anchor ? roamTarget(i, rt, 'entrance' in anchor ? anchor.entrance : anchor, fire, tick) : null;
  if (!t || !goTo(w, i, rt, t.x, t.y)) stay(w, i, 40 + Math.floor(hash2(i, tick, 71) * 60));
}
