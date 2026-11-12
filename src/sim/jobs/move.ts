import { ROAD_SPEED_MULT, type TrailStage } from '../../shared';
import { NPC_SPEED } from '../balance';
import { planRoute, sizeClassOf } from '../route';
import { stepOn } from '../systems/trails';
import { T as TILES, type SectorRt, type SimWorld } from '../world';
import { mul } from './common';
import { ST_WALK } from './consts';

/** Рух NPC: прокласти шлях і йти ним. */

/**
 * Шлях до тайла (gx,gy): маршрут за розміром NPC (planRoute: грубий A* + прямі за тайловою прохідністю).
 * Один раз на подорож. Шлях зберігається як пари (x,y) у тайлах.
 */
export function setPath(w: SimWorld, i: number, rt: SectorRt, gx: number, gy: number): boolean {
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
export function advance(w: SimWorld, i: number, rt: SectorRt): boolean {
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
