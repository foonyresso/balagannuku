import { ROAD_RADIUS, SECTOR_SIZE } from '../../shared';
import { getSectorRt } from '../../sim';
import { NPC_TILES } from '../../sim/balance';
import { selPos, type Sel } from '../../ui/info';
import { lerpPos } from '../interp';
import { planeToIso, pointInPoly, screenToPlane } from '../projection';
import { NB, TILE, type Scene, type Tile } from './scene';

/** Влучання курсором: що під точкою екрана, де намальований житель, що потрапило в рамку. Стану не змінює. */

type Pt = { clientX: number; clientY: number };
type XY = { x: number; y: number };

/** Позиція жителя, як він намальований (інтерполяція між тіками), у тайлах. */
export function npcXY(scene: Scene, i: number): XY {
  const n = scene.w.state.npcs, a = scene.clock.alpha(performance.now());
  return { x: lerpPos(scene.w.npc.px[i], n.x[i], a), y: lerpPos(scene.w.npc.py[i], n.y[i], a) };
}

/** Екранна позиція жителя (центр тіла) з урахуванням інтерполяції. */
export function npcScreen(scene: Scene, i: number): XY {
  const q = npcXY(scene, i), hw = (NPC_TILES * TILE) / 2, iso = planeToIso(q.x * TILE, q.y * TILE, hw);
  return { x: iso.x * scene.cam.zoom + scene.cam.x, y: iso.y * scene.cam.zoom + scene.cam.y };
}

/** Позиція виділеного в тайлах (група — центр мас) або null, якщо об'єкта вже немає. */
export function posOf(scene: Scene, sel: Sel): XY | null {
  if (sel.t === 'group') {
    const ps = sel.items.map((i) => posOf(scene, i)).filter((p): p is XY => !!p);
    return ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null;
  }
  const p = selPos(scene.w, scene.sector, sel);
  return p && sel.t === 'npc' ? npcXY(scene, sel.id) : p;
}

/** Тайл під курсором: спершу об'єкти від найближчого до глядача (за порядком малювання), далі земля. */
export function pickTile(scene: Scene, e: Pt): Tile | null {
  const { cam } = scene;
  const p = { x: (e.clientX - cam.x) / cam.zoom, y: (e.clientY - cam.y) / cam.zoom };
  for (let r = NB - 1; r >= 0; r--) {
    for (const o of scene.rows[r]) if (o.pick && o.tile && pointInPoly(p.x, p.y, o.pick)) return o.tile;
  }
  const g = screenToPlane(e.clientX, e.clientY, cam);
  const x = Math.floor(g.x / TILE), y = Math.floor(g.y / TILE);
  return x >= 0 && y >= 0 && x < SECTOR_SIZE && y < SECTOR_SIZE ? { x, y } : null;
}

/** Що під курсором у режимі «вибір»: житель (щедра зона влучання: рухомих важко ловити), потім споруда/дерево/камінь, потім дорога. */
export function pickSel(scene: Scene, e: Pt, speed: number): Sel | null {
  const { cam } = scene, z = cam.zoom;
  const p = { x: (e.clientX - cam.x) / z, y: (e.clientY - cam.y) / z };
  const n = scene.w.state.npcs, hw = (NPC_TILES * TILE) / 2;
  // Екранні пікселі; на швидкій грі зона більша: жителі встигають втекти, поки рука доходить до кліку
  const R = Math.max(14, hw * z * 1.8) + Math.min(60, speed * 4);
  let best = -1, bd = Infinity;
  for (let i = 0; i < n.capacity; i++) {
    if (!n.alive[i] || n.sector[i] !== scene.sector) continue;
    const s = npcScreen(scene, i), d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
    if (d <= R && d < bd) { best = i; bd = d; }
  }
  if (best >= 0) return { t: 'npc', id: best };
  for (let r = NB - 1; r >= 0; r--) {
    for (const o of scene.rows[r]) if (o.sel && o.pick && pointInPoly(p.x, p.y, o.pick)) return o.sel;
  }
  const g = screenToPlane(e.clientX, e.clientY, cam);
  const gx = Math.floor(g.x / TILE), gy = Math.floor(g.y / TILE);
  if (gx < 0 || gy < 0 || gx >= SECTOR_SIZE || gy >= SECTOR_SIZE) return null;
  const rt = getSectorRt(scene.w, scene.sector);
  let st = 0, sx = gx, sy = gy;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = gx + dx, y = gy + dy;
    if (x < 0 || y < 0 || x >= SECTOR_SIZE || y >= SECTOR_SIZE) continue;
    const s2 = rt.stage[y * SECTOR_SIZE + x], half = ROAD_RADIUS[s2] + 0.5;
    if (s2 > st && Math.abs(dx) <= half && Math.abs(dy) <= half) { st = s2; sx = x; sy = y; }
  }
  return st ? { t: 'road', x: sx, y: sy } : null;
}

/** Що потрапило в екранну рамку. Пріоритет: жителі, інакше споруди, інакше ресурси. */
export function boxItems(scene: Scene, x0: number, y0: number, x1: number, y1: number): Sel[] {
  const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
  const n = scene.w.state.npcs, { cam } = scene, z = cam.zoom;
  const items: Sel[] = [];
  for (let i = 0; i < n.capacity; i++) {
    if (!n.alive[i] || n.sector[i] !== scene.sector) continue;
    const s = npcScreen(scene, i);
    if (s.x >= r.x0 && s.x <= r.x1 && s.y >= r.y0 && s.y <= r.y1) items.push({ t: 'npc', id: i });
  }
  if (!items.length) { // споруди: габарит силуету перетинає рамку
    for (const row of scene.rows) for (const o of row) {
      if (o.sel?.t !== 'building' || !o.pick) continue;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (let k = 0; k < o.pick.length; k += 2) { a = Math.min(a, o.pick[k]); c = Math.max(c, o.pick[k]); b = Math.min(b, o.pick[k + 1]); d = Math.max(d, o.pick[k + 1]); }
      if (c * z + cam.x >= r.x0 && a * z + cam.x <= r.x1 && d * z + cam.y >= r.y0 && b * z + cam.y <= r.y1) items.push(o.sel);
    }
  }
  if (!items.length) { // ресурси: центр у рамці (не більше 200)
    for (const row of scene.rows) for (const o of row) {
      if (o.sel?.t !== 'node' || !o.pick || items.length >= 200) continue;
      let cx = 0, cy = 0;
      for (let k = 0; k < o.pick.length; k += 2) { cx += o.pick[k]; cy += o.pick[k + 1]; }
      cx = (cx / (o.pick.length / 2)) * z + cam.x; cy = (cy / (o.pick.length / 2)) * z + cam.y;
      if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) items.push(o.sel);
    }
  }
  return items;
}
