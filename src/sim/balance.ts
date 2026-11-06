import type { BuildingKind, Profession, ResourceKind } from '../shared';

/** Баланс економіки (не впливає на формат сейва). */
export const NPC_CAPACITY = 4096;
export const NPC_SPEED = 1; // тайлів за тік на землі (= 0.25 клітинки навігації)
export const CARRY_CAP = 3; // колод/каменів за один рейс (по одному за візит до вузла)
export const PROCESS_TICKS = 30; // обтесування в хатинці (лісоруб/каменяр) перед доставкою
export const WORK_TICKS = 15; // добування одиниці
export const MILL_TICKS = 20; // 2 дерева -> 1 дошка
export const WAIT_TICKS = 15; // очікування при нестачі
/** Радіус пошуку вузла від будівлі (клітинок). За замовчуванням — увесь сектор: відстань не заважає роботі. */
export const WORK_RADIUS = 64; // у клітинках навігації
export const ATTACHED_WORK_MULT = 0.8; // будівля на дорозі працює швидше
export const TREE_AMOUNT = 3;
export const STONE_AMOUNT = 8;
export const TREE_REGROW_INTERVAL = 100; // зрубане/розбите відновлюється (лише візуально, ресурс безкінечний)
export const MILL_BUFFER = 15; // буфер колод лісопильні
export const ROAD_CHECK_INTERVAL = 50;
export const HOUSE_SPAWN_INTERVAL = 200;
export const POP_BASE = 5;
export const POP_PER_HOUSE = 4;
export const START_SETTLERS = 5;
export const START_STOCK: Partial<Record<ResourceKind, number>> = { wood: 40, stone: 10, planks: 10 };

export const STORAGE_CAP: Partial<Record<BuildingKind, number>> = { townhall: 200, warehouse: 400 };
export const COSTS: Partial<Record<BuildingKind, Partial<Record<ResourceKind, number>>>> = {
  warehouse: { wood: 10 },
  lumberjack: { wood: 5 },
  quarry: { wood: 8 },
  sawmill: { wood: 10, stone: 5 },
  house: { planks: 5 },
};
/** Слоти працівників на будівлю. Продуктивність = частка зайнятих слотів (кожен працівник працює сам), окремої формули немає. */
export const MAX_WORKERS: Partial<Record<BuildingKind, number>> = { lumberjack: 2, quarry: 4, sawmill: 2 };
export const JOB_OF: Partial<Record<BuildingKind, Profession>> = {
  lumberjack: 'lumberjack', quarry: 'miner', sawmill: 'sawyer',
};

/** Резерв дерева на складах: переробка (лісопильня) не бере й не приймає дерево, поки на складах менше. Будівництво важливіше. */
export const WOOD_RESERVE = 10;

/**
 * «Тяга» NPC до доріг у пошуку шляху: вартість клітинки = 1 / (1 + ROAD_PULL * (множник_швидкості - 1)).
 * 1 = чиста вигода за швидкістю (NPC робить невеликий гак до дороги, якщо це швидше); 0 = дороги ігноруються;
 * >1 — сильніша тяга. Стадії обмежені Paved, тож петля «трафік -> дорога -> трафік» не росте безмежно.
 */
export const ROAD_PULL = 1;

/** Footprint будівель у тайлах (ширина × глибина). Конфіг: змінюється без зміни формату сейва (розмір лежить у будівлі). */
export const FOOTPRINT: Partial<Record<BuildingKind, { w: number; h: number }>> = {
  townhall: { w: 20, h: 20 },
  warehouse: { w: 12, h: 12 },
  lumberjack: { w: 8, h: 8 },
  quarry: { w: 8, h: 8 },
  sawmill: { w: 10, h: 10 },
  house: { w: 6, h: 6 },
};
/** Візуальний розмір у тайлах (без жорсткої колізії): NPC 2×2, дерево 3×3, камінь 4×4. */
export const NPC_TILES = 2, TREE_TILES = 3, STONE_TILES = 4;
/** Скільки тайлів навколо footprint має бути вільним від вузлів ресурсів при будівництві. */
export const PLACE_MARGIN = 1;

/**
 * Згасання стежок: частка трафіку, що втрачається за один інтервал (TRAIL_DECAY_INTERVAL = 50 тіків), залежно від стадії тайла:
 * [нічого/слабкий слід, стежка, дорога, вимощена]. Чим вища стадія, тим повільніше. Піввитримка (інтервалів = ln2/частка):
 * слабкий ≈ 460 (≈ 38 хв гри при 10 Гц), стежка ≈ 690, дорога ≈ 4600, вимощена ≈ 35000 (кілька діб гри). Без ходіння все одно заростає.
 */
export const TRAIL_DECAY_BY_STAGE = [0.0015, 0.001, 0.00015, 0.00002] as const;
