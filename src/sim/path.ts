import { ROAD_SPEED_MULT, SECTOR_SIZE, type TrailStage } from '../shared';

const S = SECTOR_SIZE, N = S * S;
const g = new Float32Array(N), from = new Int16Array(N);
const seen = new Uint32Array(N), closed = new Uint32Array(N);
const HCAP = N * 9;
const hf = new Float32Array(HCAP), hi = new Int16Array(HCAP);
let hn = 0, stamp = 0;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

function push(f: number, i: number): void {
  let k = hn++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (hf[p] <= f) break;
    hf[k] = hf[p]; hi[k] = hi[p]; k = p;
  }
  hf[k] = f; hi[k] = i;
}
function pop(): number {
  const top = hi[0], f = hf[--hn], i = hi[hn];
  let k = 0;
  for (;;) {
    let c = 2 * k + 1;
    if (c >= hn) break;
    if (c + 1 < hn && hf[c + 1] < hf[c]) c++;
    if (hf[c] >= f) break;
    hf[k] = hf[c]; hi[k] = hi[c]; k = c;
  }
  hf[k] = f; hi[k] = i;
  return top;
}

export interface PathGrid {
  blocked: Uint8Array;
  stage: Uint8Array; // стадія стежки на клітинку
  forest: Uint8Array; // 1 = клітинка з деревом (повільніше йти)
}

/**
 * Один A* на ПОДОРОЖ (не на крок). Вартість клітинки: стежки дешевші (ROAD_SPEED_MULT), ліс дорожчий.
 * Повертає клітинки від старту (виключно) до цілі (включно), або null. Ціль може бути «заблокованою» (вхід).
 */
export function findPath(grid: PathGrid, sx: number, sy: number, gx: number, gy: number): Int16Array | null {
  const start = sy * S + sx, goal = gy * S + gx;
  if (start === goal) return new Int16Array(0);
  stamp++;
  hn = 0;
  g[start] = 0; seen[start] = stamp; from[start] = -1;
  push(0, start);
  const { blocked, stage, forest } = grid;
  let found = false;
  while (hn > 0) {
    const cur = pop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    if (cur === goal) { found = true; break; }
    const cx = cur % S, cy = (cur / S) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const ni = ny * S + nx;
      if (closed[ni] === stamp) continue;
      if (blocked[ni] && ni !== goal) continue;
      if (d >= 4 && (blocked[cy * S + nx] || blocked[ny * S + cx])) continue; // без зрізання кутів
      const step = (d >= 4 ? 1.414 : 1) * (1 / ROAD_SPEED_MULT[stage[ni] as TrailStage]) * (forest[ni] ? 1.6 : 1);
      const ng = g[cur] + step;
      if (seen[ni] !== stamp || ng < g[ni]) {
        seen[ni] = stamp; g[ni] = ng; from[ni] = cur;
        const dx = Math.abs(nx - gx), dy = Math.abs(ny - gy);
        push(ng + 0.8 * (dx + dy - 0.586 * Math.min(dx, dy)), ni);
      }
    }
  }
  if (!found) return null;
  let len = 0;
  for (let c = goal; c !== start; c = from[c]) len++;
  const out = new Int16Array(len);
  for (let c = goal, k = len - 1; c !== start; c = from[c]) out[k--] = c;
  return out;
}
