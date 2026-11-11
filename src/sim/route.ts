import { NPC_STAT_COUNT, SECTOR_CELLS, statIndex } from '../shared';
import { clearNode, nodeCoord, nodePos, type SizeClass } from './clear';
import { findPath } from './path';
import { C as CELLS, T as TILES, TPC, cellOfTile, type SectorRt, type SimWorld } from './world';

const ST_SIZE = statIndex('size');
/** Клас розміру NPC за статом size (тайлів): ≥2 — стандартний, інакше малий. */
export const sizeClassOf = (w: SimWorld, i: number): SizeClass => (w.state.npcs.stats[i * NPC_STAT_COUNT + ST_SIZE] >= 2 ? 2 : 1);

const EXEMPT = 2.5; // біля початку й цілі (вхід у будівлю) займані тайли не перевіряємо
const LOOKAHEAD = 8;

/** Чи проходить NPC класу s по прямій (a -> b): усі вузли вздовж відрізка вільні, без зрізання кутів. */
export function los(occ: Uint8Array, s: SizeClass, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(len / 0.25));
  let pi = nodeCoord(s, ax), pj = nodeCoord(s, ay), prevChecked = false;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps, x = ax + dx * f, y = ay + dy * f;
    const i = nodeCoord(s, x), j = nodeCoord(s, y);
    if (f * len < EXEMPT || (1 - f) * len < EXEMPT) { pi = i; pj = j; prevChecked = false; continue; }
    if (!clearNode(occ, s, i, j)) return false;
    if (prevChecked && i !== pi && j !== pj && (!clearNode(occ, s, i, pj) || !clearNode(occ, s, pi, j))) return false;
    pi = i; pj = j; prevChecked = true;
  }
  return true;
}

/** Локальний A* по вузлах класу s у вікні навколо двох точок. Повертає пари позицій (без стартової й цільової) або null. */
function localPath(occ: Uint8Array, s: SizeClass, ax: number, ay: number, bx: number, by: number, pad: number): number[] | null {
  const na = [nodeCoord(s, ax), nodeCoord(s, ay)], nb = [nodeCoord(s, bx), nodeCoord(s, by)];
  const x0 = Math.max(0, Math.min(na[0], nb[0]) - pad), y0 = Math.max(0, Math.min(na[1], nb[1]) - pad);
  const x1 = Math.min(TILES - 1, Math.max(na[0], nb[0]) + pad), y1 = Math.min(TILES - 1, Math.max(na[1], nb[1]) + pad);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H;
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const ok = (i: number, j: number): boolean =>
    clearNode(occ, s, i, j) || (Math.abs(i - na[0]) <= 3 && Math.abs(j - na[1]) <= 3) || (Math.abs(i - nb[0]) <= 3 && Math.abs(j - nb[1]) <= 3);
  const heap: [number, number][] = []; // [f, idx] — вікно мале, проста купа
  const push = (f: number, v: number) => { heap.push([f, v]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = (): number => { const top = heap[0][1], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top; };
  const idx = (i: number, j: number) => (j - y0) * W + (i - x0);
  const start = idx(na[0], na[1]), goal = idx(nb[0], nb[1]);
  g[start] = 0; push(0, start);
  let found = false;
  while (heap.length) {
    const cur = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) { found = true; break; }
    const ci = x0 + (cur % W), cj = y0 + ((cur / W) | 0);
    for (let d = 0; d < 8; d++) {
      const di = d === 0 || d === 4 || d === 5 ? 1 : d === 1 || d === 6 || d === 7 ? -1 : 0;
      const dj = d === 2 || d === 4 || d === 6 ? 1 : d === 3 || d === 5 || d === 7 ? -1 : 0;
      const ni = ci + di, nj = cj + dj;
      if (ni < x0 || nj < y0 || ni > x1 || nj > y1 || !ok(ni, nj)) continue;
      if (di && dj && (!ok(ci + di, cj) || !ok(ci, cj + dj))) continue; // без зрізання кутів
      const n = idx(ni, nj), ng = g[cur] + (di && dj ? 1.414 : 1);
      if (ng < g[n]) {
        g[n] = ng; from[n] = cur;
        const hx = Math.abs(ni - nb[0]), hy = Math.abs(nj - nb[1]);
        push(ng + hx + hy - 0.586 * Math.min(hx, hy), n);
      }
    }
  }
  if (!found) return null;
  const nodes: number[] = [];
  for (let c = from[goal]; c !== start && c >= 0; c = from[c]) nodes.push(nodePos(s, y0 + ((c / W) | 0)), nodePos(s, x0 + (c % W)));
  // пари зібрані в зворотному порядку як (y,x): розвертаємо в (x,y) від старту
  const out: number[] = [];
  for (let k = nodes.length - 2; k >= 0; k -= 2) out.push(nodes[k + 1], nodes[k]);
  return out;
}

/** Вільний вузол класу s у клітинці, найближчий до центру (позиція) або центр клітинки. */
function waypoint(rt: SectorRt, s: SizeClass, cell: number): [number, number] {
  const cx = cell % CELLS, cy = (cell / CELLS) | 0, mx = cx * TPC + TPC / 2, my = cy * TPC + TPC / 2;
  let best: [number, number] | null = null, bd = Infinity;
  for (let a = 0; a < TPC + 1; a++) for (let b = 0; b < TPC + 1; b++) {
    const i = cx * TPC + a, j = cy * TPC + b;
    if (!clearNode(rt.occ, s, i, j)) continue;
    const x = nodePos(s, i), y = nodePos(s, j), d = (x - mx) ** 2 + (y - my) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best ?? [mx, my];
}

/**
 * Маршрут для NPC класу розміру s від (sx,sy) до тайла (gx,gy): A* по грубих клітинках (з прохідністю класу),
 * спрощення прямими за вільними вузлами, у вузьких місцях — локальний A* по тайлах. Пари (x,y) у тайлах або null.
 */
export function planRoute(rt: SectorRt, s: SizeClass, sx: number, sy: number, gx: number, gy: number): number[] | null {
  const sc = cellOfTile(Math.floor(sx), Math.floor(sy)), gc = cellOfTile(gx, gy);
  const cells = findPath({ blocked: s === 1 ? rt.blocked1 : rt.blocked2, cellStage: rt.cellStage, forest: rt.forest }, sc % CELLS, (sc / CELLS) | 0, gc % CELLS, (gc / CELLS) | 0);
  if (!cells) return null;
  const px: number[] = [sx], py: number[] = [sy];
  for (let k = 0; k < cells.length - 1; k++) { const [x, y] = waypoint(rt, s, cells[k]); px.push(x); py.push(y); }
  px.push(gx + 0.5); py.push(gy + 0.5);
  const out: number[] = [], last = px.length - 1;
  let a = 0;
  while (a < last) {
    let b = Math.min(last, a + LOOKAHEAD);
    // Не зрізаємо повз клітинки зі стежкою: йдемо ними від центру до центру — трафік лягає в одну лінію, а не віялом паралельних.
    for (let j = a + 1; j < b; j++) if (rt.cellStage[cells[j - 1]] > 0) { b = j; break; }
    while (b > a + 1 && !los(rt.occ, s, px[a], py[a], px[b], py[b])) b--;
    if (b === a + 1 && !los(rt.occ, s, px[a], py[a], px[b], py[b])) {
      const loc = localPath(rt.occ, s, px[a], py[a], px[b], py[b], 12) ?? localPath(rt.occ, s, px[a], py[a], px[b], py[b], 48);
      if (!loc) return null;
      // спростити локальний відрізок прямими
      const pts = [px[a], py[a], ...loc, px[b], py[b]];
      let c = 0;
      while (c < pts.length - 2) {
        let e = pts.length - 2;
        while (e > c + 2 && !los(rt.occ, s, pts[c], pts[c + 1], pts[e], pts[e + 1])) e -= 2;
        out.push(pts[e], pts[e + 1]);
        c = e;
      }
    } else out.push(px[b], py[b]);
    a = b;
  }
  return out;
}
export { SECTOR_CELLS };
