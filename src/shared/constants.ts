/** Спільні числові константи. Зміна впливає на формат сейва — підніми SAVE_VERSION і додай міграцію. */

export const SIM_TICK_HZ = 10;
/**
 * Сітка сектора. ТАЙЛ — найменша одиниця (стежки, footprint будівель, позиції NPC).
 * КЛІТИНКА (зона навігації) = TILES_PER_CELL×TILES_PER_CELL тайлів: A* шукає шлях по грубій сітці клітинок,
 * а рух і стежки — по тайлах. Зміна цих констант змінює формат сейва (SAVE_VERSION).
 */
export const TILES_PER_CELL = 4;
/** Активна зона міста (де можна будувати й ходити), клітинок навігації на сторону. Розширення міста = збільшення цього числа (+ SAVE_VERSION). */
export const ACTIVE_CELLS = 700;
/** Неактивна смуга довкола активної зони: густий ліс і скелі, будувати й ходити не можна, візуально — туман. */
export const BORDER_CELLS = 64;
export const SECTOR_CELLS = ACTIVE_CELLS + 2 * BORDER_CELLS; // уся карта: клітинок навігації на сторону (828 → 3312² тайлів)
export const ACTIVE_MIN_TILE = BORDER_CELLS * TILES_PER_CELL; // перший активний тайл
export const ACTIVE_MAX_TILE = (BORDER_CELLS + ACTIVE_CELLS) * TILES_PER_CELL; // перший тайл ПІСЛЯ активної зони
export const isActiveTile = (x: number, y: number): boolean => x >= ACTIVE_MIN_TILE && y >= ACTIVE_MIN_TILE && x < ACTIVE_MAX_TILE && y < ACTIVE_MAX_TILE;
export const isActiveCell = (cx: number, cy: number): boolean => cx >= BORDER_CELLS && cy >= BORDER_CELLS && cx < BORDER_CELLS + ACTIVE_CELLS && cy < BORDER_CELLS + ACTIVE_CELLS;
export const SECTOR_SIZE = SECTOR_CELLS * TILES_PER_CELL; // ТАЙЛІВ на сторону сектора (2048)
/**
 * Видимий світ міста: квадратна сітка секторів навколо домашнього, (2·WORLD_RING+1)². 1 → 3×3, 2 → 5×5.
 * Сусідні сектори поки лише ландшафт (ресурси з seed, лазі-створення); місця під розширення й інших гравців.
 */
export const WORLD_RING = 0;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MIN_START_DISTANCE = 8; // у секторах (параметр, мін. 4–5)

/** Стежки: див. trails.ts. */
export const TRAIL_STEP_ADD = 1; // приріст трафіку за прохід одного NPC
export const TRAIL_DECAY_INTERVAL = 50; // тіків між проходами згасання
export const TRAIL_DECAY_FACTOR = 0.98; // множник трафіку за інтервал
export const TRAIL_MAX = 60000; // стеля (u16)
