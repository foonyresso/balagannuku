import type { BuildingState, Campfire } from '../shared';
import {
  ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, CAMP_MIN_SLOTS, CAMP_OFFSET, CAMP_PLAZA, ROAD_SPEED_MULT, ROAM_RADIUS, TASKS, campSlotSpot,
  NPC_STAT_COUNT, statIndex, type TrailStage,
} from '../shared';
import { NPC_SPEED } from './balance';
import { hash2 } from './rng';
import { planRoute, sizeClassOf } from './route';
import { T as TILES, getSectorRt, type SectorRt, type SimWorld } from './world';

/** Фази вільного жителя (не перетинаються з PHASE роботи): 0 — вирішити, далі йти, далі стояти. */
const DECIDE = 0, IDLE_WALK = 21, IDLE_STAY = 22;
const TASK_IDLE = TASKS.indexOf('idle'), TASK_WALK = TASKS.indexOf('walk');
const ST_WALK = statIndex('walk');

/** Перша завершена ратуша гравця в секторі (вона ж «центр» міста для вогнища). */
export function hallOf(w: SimWorld, owner: string, sector: number): BuildingState | null {
  for (const b of w.state.buildings) if (b.kind === 'townhall' && b.owner === owner && b.sector === sector && b.progress >= 1) return b;
  return null;
}

/** Квадрат зони вогнища повністю в активній зоні й без зайнятих тайлів (будівлі, вода). */
function plazaFree(rt: SectorRt, x: number, y: number): boolean {
  const r = CAMP_PLAZA;
  if (x - r < ACTIVE_MIN_TILE || y - r < ACTIVE_MIN_TILE || x + r >= ACTIVE_MAX_TILE || y + r >= ACTIVE_MAX_TILE) return false;
  for (let ty = y - r; ty <= y + r; ty++) for (let tx = x - r; tx <= x + r; tx++) if (rt.occ[ty * TILES + tx]) return false;
  return true;
}

/**
 * Позиція вогнища ратуші: перед нею (нижче входу) на відстані CAMP_OFFSET; якщо там зайнято (вода, споруда) —
 * найближче вільне місце. Результат кешується (і далі не змінюється: навколо вогнища не будують).
 */
export function campfireOf(w: SimWorld, hall: BuildingState): Campfire {
  const cached = w.fires.get(hall.id);
  if (cached) return cached;
  const rt = getSectorRt(w, hall.sector);
  const nx = hall.entrance.x, ny = hall.entrance.y + CAMP_OFFSET;
  let fire: Campfire = { x: nx, y: ny };
  search: for (let r = 0; r <= 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        if (plazaFree(rt, nx + dx, ny + dy)) { fire = { x: nx + dx, y: ny + dy }; break search; }
        if (step === 0) break;
      }
    }
  }
  w.fires.set(hall.id, fire);
  return fire;
}

/** Вогнище міста гравця в секторі (або null, якщо ратуші ще нема). */
export function campfireFor(w: SimWorld, owner: string, sector: number): Campfire | null {
  const hall = hallOf(w, owner, sector);
  return hall ? campfireOf(w, hall) : null;
}

/** Чи прямокутник footprint (x,y,w,h) заходить у зону вогнища ратуші цього сектора. */
export function hitsCampPlaza(w: SimWorld, sector: number, x: number, y: number, fw: number, fh: number): boolean {
  for (const b of w.state.buildings) {
    if (b.kind !== 'townhall' || b.sector !== sector) continue;
    const f = campfireOf(w, b), r = CAMP_PLAZA;
    if (x < f.x + r + 1 && x + fw > f.x - r && y < f.y + r + 1 && y + fh > f.y - r) return true;
  }
  return false;
}

/**
 * Перерозподіл слотів біля вогнища серед вільних жителів кожного (гравець, сектор): слот у ратуші-вогнища мають
 * min(вільних, CAMP_MIN_SLOTS) жителів. Чинні «вогнищники» лишаються; порожні слоти займають найближчі вільні.
 * Тих, чия роль змінилась (стали «вогнищниками» чи звільнили слот), змушуємо перепланувати дію.
 */
export function rebalanceCamp(w: SimWorld): void {
  const n = w.state.npcs, npc = w.npc;
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n.capacity; i++) {
    if (!n.alive[i]) continue;
    if (npc.workplace[i] >= 0) { npc.camp[i] = -1; continue; }
    const key = n.owner[i] * 65536 + n.sector[i];
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  }
  for (const [key, group] of groups) {
    const owner = w.state.players[(key / 65536) | 0]?.id, sector = key % 65536;
    const fire = owner ? campfireFor(w, owner, sector) : null;
    const before = group.map((i) => npc.camp[i]);
    if (!fire) { for (const i of group) npc.camp[i] = -1; } else {
      const used = new Set<number>();
      for (const i of group) { const s = npc.camp[i]; if (s >= 0 && s < CAMP_MIN_SLOTS && !used.has(s)) used.add(s); else npc.camp[i] = -1; }
      for (let slot = 0; slot < CAMP_MIN_SLOTS; slot++) {
        if (used.has(slot)) continue;
        let best = -1, bd = Infinity;
        for (const i of group) {
          if (npc.camp[i] >= 0) continue;
          const d = Math.hypot(n.x[i] - fire.x, n.y[i] - fire.y);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) break;
        npc.camp[best] = slot; used.add(slot);
      }
    }
    group.forEach((i, k) => { if (npc.camp[i] !== before[k]) { npc.phase[i] = DECIDE; npc.path[i] = null; } });
  }
}

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
