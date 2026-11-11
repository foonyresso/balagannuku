import { ensureAtlas } from './atlas';
import { registerBuildingSprites } from './buildings';
import { registerCharacters } from './characters';
import { registerProps } from './props';
import { registerAnimals } from './animals';

export { spr, renderSprite, spriteIds, spriteDef } from './atlas';
export { buildingArt } from './buildings';
export { Atmosphere, TIMES, makeVignette, nextTime, type TimeKey } from './atmosphere';
export { Particles } from './particles';
export { makeGround } from './ground';
export * from './characters';
export { ANIMAL_IDLE_FRAMES, ANIMAL_SCALE, animalFrameId, animalWalkFrame, LOOK as ANIMAL_LOOK } from './animals';
export { OAK_VARIANTS, PINE_VARIANTS, ROCK_VARIANTS, BUSH_VARIANTS, PROP_SCALE } from './props';

/** Палітра місцевості (вода, стежки) — єдине місце. */
export const PALETTE = {
  waterShallow: 0x33607a, waterDeep: 0x27455a, shore: 0x5c5a48,
  trail: [0, 0x7f6a46, 0xa58a62, 0xb4ac9c] as const, trailAlt: [0, 0x6f5c3c, 0x96794f, 0xa29a8a] as const,
  fog: 0x0b0814,
};

let registered = false, ready = false;
/** Реєструє визначення спрайтів (без малювання в атлас; для автотестів). */
export function registerStyleDefs(tile: number): void {
  if (registered) return;
  registered = true;
  registerProps(); registerCharacters(); registerAnimals(); registerBuildingSprites(tile);
}
/** Реєструє й малює всі спрайти стилю в атласи (раз на запуск). tile — одиниць площини на тайл. */
export function initStyle(tile: number): void {
  if (ready) return;
  ready = true;
  registerStyleDefs(tile);
  ensureAtlas();
}

/** Детермінований вибір варіанта (0..n-1) за координатами клітинки. */
export function variant(cx: number, cy: number, n: number, salt = 0): number {
  let h = Math.imul(cx * 73856093 ^ cy * 19349663 ^ salt * 83492791, 2654435761);
  h = (h ^ (h >>> 15)) >>> 0;
  return h % n;
}
/** Id спрайта дерева для клітинки: ~60% сосен. */
export function treeSpriteId(cx: number, cy: number, oaks: number, pines: number): string {
  const v = variant(cx, cy, 100);
  return v < 60 ? `pine${v % pines}` : `oak${v % oaks}`;
}
