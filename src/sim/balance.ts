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
/**
 * Стадії дерева (rt.amount клітинки): 0 пеньок, 1 саджанець, 2 молоде, 3 доросле (TREE_AMOUNT) — лише його можна рубати.
 * Пеньок відростає стадіями; ресурс не вичерпується, але кількість дорослих дерев обмежена швидкістю росту.
 */
export const TREE_AMOUNT = 3;
export const TREE_STAGE_TICKS = 150; // тіків на одну стадію при множнику росту 1
export const TREE_GROW_STEP = 10; // раз на стільки тіків перевіряємо ріст
/** Глобальний множник швидкості росту дерев (майбутнє дерево покращень / більше лісопилок). Змінний. */
export const TREE_GROWTH = { mult: 1 };
export const TREE_CHOP_TICKS = 24; // рубка одного дерева лісорубом (потім дерево падає)
export const STONE_AMOUNT = 8;
export const STONE_REGROW_INTERVAL = 100; // розбите каміння відновлюється (лише візуально, ресурс безкінечний)
export const MILL_BUFFER = 15; // буфер колод лісопильні
export const ROAD_CHECK_INTERVAL = 50;
export const HOUSE_SPAWN_INTERVAL = 200;
export const POP_BASE = 5;
export const POP_PER_HOUSE = 4;
export const START_SETTLERS = 5;
export const START_STOCK: Partial<Record<ResourceKind, number>> = { wood: 40, stone: 10, planks: 10, food: 30 };

export const STORAGE_CAP: Partial<Record<BuildingKind, number>> = { townhall: 1e9, warehouse: 400 } // ратуша (головний склад) безкінечна; підсклад має буфер, який носії розвантажують;
export const COSTS: Partial<Record<BuildingKind, Partial<Record<ResourceKind, number>>>> = {
  warehouse: { wood: 10 },
  lumberjack: { wood: 5 },
  quarry: { wood: 8 },
  sawmill: { wood: 10, stone: 5 },
  house: { planks: 5 },
  farm: { wood: 10, planks: 2 },
  hunter: { wood: 8 },
  fisher: { wood: 8 },
};
/** Слоти працівників на будівлю. Продуктивність = частка зайнятих слотів (кожен працівник працює сам), окремої формули немає. */
export const MAX_WORKERS: Partial<Record<BuildingKind, number>> = { lumberjack: 2, quarry: 4, sawmill: 2, warehouse: 4, farm: 3, hunter: 2, fisher: 2 };
/** Типова кількість працівників: решта будівель заповнюється повністю, підсклад — лише за командою гравця. */
export const DEFAULT_WORKERS: Partial<Record<BuildingKind, number>> = { warehouse: 0 };
/** Ноша носія підскладу за рейс (більша за звичайну). */
export const CARRIER_CAP = 12;
export const JOB_OF: Partial<Record<BuildingKind, Profession>> = {
  lumberjack: 'lumberjack', quarry: 'miner', sawmill: 'sawyer', warehouse: 'carrier', farm: 'farmer', hunter: 'hunter', fisher: 'fisher',
};

/** Резерв дерева на складах: переробка (лісопильня) не бере й не приймає дерево, поки на складах менше. Будівництво важливіше. */
export const WOOD_RESERVE = 10;

/**
 * «Тяга» NPC до доріг у пошуку шляху (незалежно від реальної швидкості): множник вартості кроку по стадії стежки
 * (None, Trampled, Road, Paved). Дорога дешевша за бездоріжжя (~0.6-0.85), тож шлях трохи довший, але по дорозі,
 * обирається, коли вигода помітна; великі об'їзди не виникають (безрежимний перекіс, не «магніт»).
 */
export const ROAD_PATH_COST: readonly number[] = [1, 0.85, 0.7, 0.6];
/** Сила тяги: 1 = ROAD_PATH_COST як є; 0 = дороги ігноруються; проміжні значення — інтерполяція. */
export const ROAD_PULL = 1;

/** Footprint будівель у тайлах (ширина × глибина). Конфіг: змінюється без зміни формату сейва (розмір лежить у будівлі). */
export const FOOTPRINT: Partial<Record<BuildingKind, { w: number; h: number }>> = {
  townhall: { w: 20, h: 20 },
  warehouse: { w: 12, h: 12 },
  lumberjack: { w: 8, h: 8 },
  quarry: { w: 8, h: 8 },
  sawmill: { w: 10, h: 10 },
  house: { w: 6, h: 6 },
  farm: { w: 10, h: 10 },
  hunter: { w: 8, h: 8 },
  fisher: { w: 8, h: 8 },
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

/**
 * Їжа й голод. Ситість 0..FULL_MAX спадає на 1 кожні HUNGER_INTERVAL тіків (з повної до EAT_BELOW ≈ 600 тіків).
 * Нижче EAT_BELOW NPC між діями йде до найближчого складу з їжею й з'їдає 1 од. (+FOOD_RESTORE).
 * Нижче HUNGRY_BELOW працює повільніше (HUNGRY_MULT); на 0 без їжі не працює (фермер лише сповільнюється, щоб не було глухого кута).
 */
export const FULL_MAX = 100, HUNGER_INTERVAL = 12, EAT_BELOW = 50, HUNGRY_BELOW = 30, FOOD_RESTORE = 50, HUNGRY_MULT = 0.5;
/** Ферма: одна од. їжі за FARM_TICKS роботи, фермер несе до FARM_CARRY за рейс. */
export const FARM_TICKS = 150, FARM_CARRY = 4;
/** Рибалка: ставиться на березі (вхід не далі FISH_SHORE_RADIUS тайлів від води), 1 од. їжі за FISH_TICKS. */
export const FISH_TICKS = 120, FISH_SHORE_RADIUS = 12;
