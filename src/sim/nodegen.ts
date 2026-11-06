import { fbm } from './noise';
import { hash2 } from './rng';

/** Налаштування генерації вузлів ресурсів (дерева, каміння) у секторі. Усе в клітинках навігації. */
export const NODEGEN = {
  /** Повністю вільний майданчик навколо ратуші (радіус). Площа ≈ π·r² (24 → ~1800 клітинок із 4096). */
  clearRadius: 24,
  /** Ширина смуги, де щільність росте від 0 до звичайної. */
  fadeWidth: 8,
  /** Масштаб шуму груп (менше = більші гаї/скелі). */
  treeScale: 0.05,
  stoneScale: 0.07,
  /** Пороги шуму: вище = рідші групи (віднімається богатство ресурсу). */
  treeThreshold: 0.64,
  stoneThreshold: 0.74,
  /** Щільність усередині групи (частка клітинок із вузлом). */
  treeDensity: 0.5,
  stoneDensity: 0.45,
} as const;

export type NodeKindId = 0 | 1 | 2; // 0 нічого, 1 дерево, 2 камінь

/**
 * Вид вузла в клітинці (x, y) сектора. Чиста функція від seed і сектора.
 * center — клітинка ратуші. Біля неї — чистий майданчик, далі дерева й камінь лише групами (гаї, скелі).
 */
export function genNode(
  seed: number, sectorId: number, wood: number, stone: number, x: number, y: number, center: number,
): NodeKindId {
  const c = NODEGEN;
  const d = Math.hypot(x - center, y - center);
  if (d < c.clearRadius) return 0;
  // 0..1 у смузі розмиття: різні для дерев і каміння випадкові пороги, щоб край не був рівним колом
  const fade = Math.min(1, (d - c.clearRadius) / c.fadeWidth);
  const ox = sectorId * 13.7, oy = seed % 97;
  const h = hash2(x, y, seed ^ (sectorId * 7919));
  if (fbm(x * c.treeScale + ox, y * c.treeScale + oy, 101) > c.treeThreshold - 0.25 * wood && h < c.treeDensity * fade) return 1;
  if (fbm(x * c.stoneScale + ox, y * c.stoneScale + oy, 202) > c.stoneThreshold - 0.2 * stone && h > 1 - c.stoneDensity * fade) return 2;
  return 0;
}
