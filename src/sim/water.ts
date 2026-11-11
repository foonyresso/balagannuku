import { ACTIVE_MAX_TILE, ACTIVE_MIN_TILE, SECTOR_CELLS, TILES_PER_CELL } from '../shared';
import { fbm } from './noise';
import { hash2 } from './rng';

/**
 * Вода (лише кілька озер, без річок): ЧИСТА функція світових координат тайла (seed, tx, ty) — безшовна, без залежності від меж секторів,
 * у сейві не зберігається (виводиться з seed). Вода — лише в активній зоні, не ближче WATER.clearRadius клітинок до ратуші;
 * гарантоване «домашнє» озеро в досяжній відстані від старту. Непрохідна для NPC, на ній не можна будувати.
 */
export interface WaterConfig {
  clearRadius: number; // клітинок навколо ратуші без води
  homeDist: number; // відстань (клітинок) від ратуші до центру домашнього озера
  homeRadius: number; // базовий радіус домашнього озера (клітинок)
  lakeScale: number; lakeThreshold: number; // шум озер (на тайл)
}
export const WATER: WaterConfig = {
  clearRadius: 40, homeDist: 62, homeRadius: 14,
  lakeScale: 0.0035, lakeThreshold: 0.82,
};
const DEFAULT_WATER = { ...WATER };
export function configureWater(p: Partial<WaterConfig>): void { Object.assign(WATER, p); }
export function resetWater(): void { Object.assign(WATER, DEFAULT_WATER); }

const CENTER_TILE_W = (SECTOR_CELLS >> 1) * TILES_PER_CELL + TILES_PER_CELL / 2; // ≈ центр ратуші в тайлах

/** Центр домашнього озера (тайли): напрям від seed. */
export function homeLake(seed: number): { x: number; y: number; r: number } {
  const a = hash2(seed, 17, 0x1a4e) * Math.PI * 2;
  const d = WATER.homeDist * TILES_PER_CELL;
  return { x: CENTER_TILE_W + Math.cos(a) * d, y: CENTER_TILE_W + Math.sin(a) * d, r: WATER.homeRadius * TILES_PER_CELL };
}

const STEP = 8; // крок ґратки шуму (тайлів): поля гладкі, між вузлами — білінійна інтерполяція
const offs = (seed: number) => ({ ox: (Math.abs(seed) % 1009) * 7.3, oy: (Math.abs(seed >> 8) % 997) * 3.1 });
/** Гладке поле озер у вузлі ґратки (i, j) -> тайл (i·STEP, j·STEP). */
function sampleFields(seed: number, i: number, j: number, out: Float32Array, k: number): void {
  const c = WATER, { ox, oy } = offs(seed), x = i * STEP, y = j * STEP;
  out[k] = fbm(x * c.lakeScale + ox, y * c.lakeScale + oy, 707);
}
/** Остаточне рішення для тайла за інтерпольованим полем L (+ мікро-шум берега, щоб він не був гладким). */
function decide(seed: number, hl: { x: number; y: number; r: number }, tx: number, ty: number, L: number): boolean {
  if (tx < ACTIVE_MIN_TILE || ty < ACTIVE_MIN_TILE || tx >= ACTIVE_MAX_TILE || ty >= ACTIVE_MAX_TILE) return false;
  const c = WATER, ddx = tx - hl.x, ddy = ty - hl.y, dh2 = ddx * ddx + ddy * ddy, dh = Math.sqrt(dh2);
  if (dh2 < hl.r * hl.r * 2.56) { // форма озера: радіус збурюється шумом уздовж берега
    const k = fbm(tx * 0.03 + 5, ty * 0.03 + 9, 77 + (seed & 255));
    if (dh < hl.r * (0.62 + 0.75 * k)) return true;
  }
  const cx = tx - CENTER_TILE_W, cy = ty - CENTER_TILE_W, cr = c.clearRadius * TILES_PER_CELL;
  if (cx * cx + cy * cy < cr * cr) return false;
  const jit = (hash2(tx, ty, 0x77a1) - 0.5) * 0.012;
  return L + jit > c.lakeThreshold;
}

/** Чи вода в тайлі (tx, ty) — світові координати тайла. Збігається з fillWater. */
export function waterAt(seed: number, tx: number, ty: number): boolean {
  const i = Math.floor(tx / STEP), j = Math.floor(ty / STEP), fx = (tx - i * STEP) / STEP, fy = (ty - j * STEP) / STEP;
  const f = new Float32Array(4);
  sampleFields(seed, i, j, f, 0); sampleFields(seed, i + 1, j, f, 1); sampleFields(seed, i, j + 1, f, 2); sampleFields(seed, i + 1, j + 1, f, 3);
  return decide(seed, homeLake(seed), tx, ty, (f[0] * (1 - fx) + f[1] * fx) * (1 - fy) + (f[2] * (1 - fx) + f[3] * fx) * fy);
}

/** Масово заповнити маску води (1 = вода) для тайлів size×size; швидко (ґратка + інтерполяція), результат збігається з waterAt. Повертає кількість водяних тайлів. */
export function fillWater(seed: number, out: Uint8Array, size: number): number {
  const n = Math.ceil(size / STEP) + 2, grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sampleFields(seed, i, j, grid, j * n + i);
  let count = 0;
  const hl = homeLake(seed), c = WATER;
  const hlI0 = Math.floor((hl.x - hl.r * 1.7) / STEP), hlI1 = Math.floor((hl.x + hl.r * 1.7) / STEP);
  const hlJ0 = Math.floor((hl.y - hl.r * 1.7) / STEP), hlJ1 = Math.floor((hl.y + hl.r * 1.7) / STEP);
  for (let j = Math.floor(ACTIVE_MIN_TILE / STEP); j * STEP < ACTIVE_MAX_TILE && j * STEP < size; j++) {
    for (let i = Math.floor(ACTIVE_MIN_TILE / STEP); i * STEP < ACTIVE_MAX_TILE && i * STEP < size; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      const nearHome = i >= hlI0 && i <= hlI1 && j >= hlJ0 && j <= hlJ1;
      if (!nearHome) { // блок без шансу на воду пропускаємо
        if (Math.max(grid[a], grid[b], grid[cc], grid[d]) < c.lakeThreshold - 0.03) continue;
      }
      for (let ty = j * STEP; ty < (j + 1) * STEP && ty < size; ty++) {
        const fy = (ty - j * STEP) / STEP;
        for (let tx = i * STEP; tx < (i + 1) * STEP && tx < size; tx++) {
          const fx = (tx - i * STEP) / STEP, w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
          const L = grid[a] * w0 + grid[b] * w1 + grid[cc] * w2 + grid[d] * w3;
          if (decide(seed, hl, tx, ty, L)) { out[ty * size + tx] = 1; count++; }
        }
      }
    }
  }
  return count;
}

/** Мінімальний контракт для економіки: у секторі є маска води (Uint8Array на тайл, T×T). */
export interface WaterRt { water: Uint8Array }

const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];

/**
 * Найближчий берег до тайла (x, y): сухий тайл (не вода, не зайнятий будівлею), що межує (4-сусідство) з водою, у радіусі maxR тайлів.
 * Повертає також тайл води, на який дивиться берег. null — берега поблизу немає.
 */
export function nearestShore(
  rt: WaterRt & { occ: Uint8Array }, size: number, x: number, y: number, maxR = 64,
): { x: number; y: number; waterX: number; waterY: number } | null {
  let best: { x: number; y: number; waterX: number; waterY: number } | null = null, bd = Infinity;
  const x0 = Math.max(1, x - maxR), x1 = Math.min(size - 2, x + maxR), y0 = Math.max(1, y - maxR), y1 = Math.min(size - 2, y + maxR);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * size + tx;
      if (rt.water[i] || rt.occ[i]) continue;
      const d = (tx - x) * (tx - x) + (ty - y) * (ty - y);
      if (d >= bd) continue;
      for (let k = 0; k < 4; k++) {
        if (rt.water[(ty + DY[k]) * size + tx + DX[k]]) { bd = d; best = { x: tx, y: ty, waterX: tx + DX[k], waterY: ty + DY[k] }; break; }
      }
    }
  }
  return best;
}
