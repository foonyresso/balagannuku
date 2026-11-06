import { SECTOR_CELLS, SECTOR_SIZE, TILES_PER_CELL } from '../shared';

/**
 * Прохідність за розміром NPC. Клас розміру s = ширина NPC в тайлах (1 — малий, 2 — стандартний).
 * Вузли руху: s=1 — центри тайлів (вузол вільний, якщо тайл вільний); s=2 — вершини між тайлами
 * (вузол вільний, якщо вільні всі 4 тайли навколо вершини). Тому прохід у 1 тайл пролазить лише малий, у 2 тайли — обидва.
 */
const T = SECTOR_SIZE, C = SECTOR_CELLS, TPC = TILES_PER_CELL;
export type SizeClass = 1 | 2;

export function clearNode(occ: Uint8Array, s: SizeClass, i: number, j: number): boolean {
  if (s === 1) return i >= 0 && j >= 0 && i < T && j < T && occ[j * T + i] === 0;
  if (i < 1 || j < 1 || i >= T || j >= T) return false;
  const a = (j - 1) * T + i - 1;
  return occ[a] === 0 && occ[a + 1] === 0 && occ[a + T] === 0 && occ[a + T + 1] === 0;
}
export const nodeCoord = (s: SizeClass, p: number): number => (s === 1 ? Math.floor(p) : Math.round(p));
export const nodePos = (s: SizeClass, i: number): number => (s === 1 ? i + 0.5 : i);

/** Перерахувати карти прохідності клітинок навігації (1 = у клітинці немає жодного вільного вузла класу) у прямокутнику клітинок. */
export function refreshClear(occ: Uint8Array, b1: Uint8Array, b2: Uint8Array, cx0: number, cx1: number, cy0: number, cy1: number): void {
  for (let cy = Math.max(0, cy0); cy <= Math.min(C - 1, cy1); cy++) {
    for (let cx = Math.max(0, cx0); cx <= Math.min(C - 1, cx1); cx++) {
      let h1 = false, h2 = false;
      for (let a = 0; a < TPC && !(h1 && h2); a++) {
        for (let b = 0; b < TPC; b++) {
          if (!h1 && clearNode(occ, 1, cx * TPC + a, cy * TPC + b)) h1 = true;
          if (!h2 && clearNode(occ, 2, cx * TPC + a + 1, cy * TPC + b + 1)) h2 = true;
        }
      }
      b1[cy * C + cx] = h1 ? 0 : 1; b2[cy * C + cx] = h2 ? 0 : 1;
    }
  }
}
