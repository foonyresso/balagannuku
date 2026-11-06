/** Спільні числові константи. Зміна впливає на формат сейва — підніми SAVE_VERSION і додай міграцію. */

export const SIM_TICK_HZ = 10;
export const SECTOR_SIZE = 64; // клітинок на сторону всередині сектора
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MIN_START_DISTANCE = 8; // у секторах (параметр, мін. 4–5)

/** Стежки: див. trails.ts. */
export const TRAIL_STEP_ADD = 1; // приріст трафіку за прохід одного NPC
export const TRAIL_DECAY_INTERVAL = 50; // тіків між проходами згасання
export const TRAIL_DECAY_FACTOR = 0.98; // множник трафіку за інтервал
export const TRAIL_MAX = 60000; // стеля (u16)
