import { fbm } from './noise';
import { hash2 } from './rng';

/** Налаштування генерації вузлів ресурсів (дерева, каміння) у секторі. Усе в клітинках навігації. */
export interface NodegenConfig {
  clearRadius: number; fadeWidth: number; treeScale: number; stoneScale: number;
  treeThreshold: number; stoneThreshold: number; treeDensity: number; stoneDensity: number;
  treeRichGain: number; stoneRichGain: number;
  richRadius: number; farRadius: number; farFactor: number; meadowScale: number; meadowCut: number;
}

export const NODEGEN: NodegenConfig = {
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
  /**
   * До цього радіуса від ратуші групи «звичайні» (робітники мають де брати ресурс: радіус роботи 64 клітинки),
   * далі групи рідшають до farFactor — великі відкриті поляни й рідкі далекі гаї.
   */
  richRadius: 70,
  farRadius: 130,
  farFactor: 0.25,
  /** Великі поляни: низькочастотна маска, де груп немає зовсім. */
  meadowScale: 0.018,
  meadowCut: 0.52,
  /** Наскільки богатство сектора знижує поріг (щедріші сектори мають більше груп). */
  treeRichGain: 0.25,
  stoneRichGain: 0.2,
};
const DEFAULTS: NodegenConfig = { ...NODEGEN };

/** Налаштування на льоту (тести економіки, режими балансу). */
export function configureNodegen(p: Partial<NodegenConfig>): void { Object.assign(NODEGEN, p); }
export function resetNodegen(): void { Object.assign(NODEGEN, DEFAULTS); }

/** Компактний «старий» світ: тісна ратуша й щільний ліс поруч — для детермінованих тестів економіки. */
export const COMPACT_NODEGEN: Partial<NodegenConfig> = {
  clearRadius: 5, fadeWidth: 0.001, treeScale: 0.1, stoneScale: 0.14, treeThreshold: 0.62, stoneThreshold: 0.7,
  treeDensity: 0.55, stoneDensity: 0.5, treeRichGain: 0.3, stoneRichGain: 0.3, richRadius: 1e9, meadowCut: -1,
};

/** Густий ліс і скелі неактивної смуги (лише вигляд; у симуляції там вузлів немає). Чиста функція світових координат. */
export function genBorderNode(seed: number, x: number, y: number): NodeKindId {
  const h = hash2(x, y, seed ^ 0x5bd1);
  return h < 0.07 ? 1 : h < 0.09 ? 2 : 0;
}

export type NodeKindId = 0 | 1 | 2; // 0 нічого, 1 дерево, 2 камінь

/** Змішує seed світу з id сектора: різні сектори — різні карти, всередині сектора шум суцільний. */
export const mixNodeSeed = (seed: number, sectorId: number): number => (seed ^ Math.imul(sectorId + 1, 7919)) | 0;

/**
 * Вид вузла у СВІТОВИХ координатах клітинки (x, y). Чиста функція від (seed, x, y): не залежить від меж секторів,
 * тож кластери лісу й каміння безшовно продовжуються через будь-яку лінію (x, y можуть виходити за [0, SECTOR_CELLS)).
 * center — світова клітинка ратуші. Біля неї — чистий майданчик, далі дерева й камінь лише групами (гаї, скелі).
 */
export function genNode(
  seed: number, wood: number, stone: number, x: number, y: number, center: number,
): NodeKindId {
  const c = NODEGEN;
  const d = Math.hypot(x - center, y - center);
  if (d < c.clearRadius) return 0;
  // 0..1 у смузі розмиття: різні для дерев і каміння випадкові пороги, щоб край не був рівним колом
  const edge = Math.min(1, (d - c.clearRadius) / c.fadeWidth);
  const far = d <= c.richRadius ? 1 : 1 - (1 - c.farFactor) * Math.min(1, (d - c.richRadius) / (c.farRadius - c.richRadius));
  const fade = edge * far;
  const ox = (Math.abs(seed) % 1009) * 13.7, oy = Math.abs(seed >> 8) % 997;
  const h = hash2(x, y, seed);
  // поляни: за межею «багатої» зони великі ділянки без жодних вузлів
  if (d > c.richRadius && fbm(x * c.meadowScale + ox, y * c.meadowScale + oy, 303) < c.meadowCut) return 0;
  if (fbm(x * c.treeScale + ox, y * c.treeScale + oy, 101) > c.treeThreshold - c.treeRichGain * wood && h < c.treeDensity * fade) return 1;
  if (fbm(x * c.stoneScale + ox, y * c.stoneScale + oy, 202) > c.stoneThreshold - c.stoneRichGain * stone && h > 1 - c.stoneDensity * fade) return 2;
  return 0;
}
