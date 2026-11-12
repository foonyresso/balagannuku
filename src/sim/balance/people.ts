import type { ResourceKind } from '../../shared';

/** Жителі: рух, населення, старт міста, їжа й голод. */

export const NPC_CAPACITY = 4096;
export const NPC_SPEED = 1; // тайлів за тік на землі (= 0.25 клітинки навігації)
/** Візуальний розмір жителя в тайлах (без жорсткої колізії). */
export const NPC_TILES = 2;

export const HOUSE_SPAWN_INTERVAL = 200;
export const POP_BASE = 5;
export const POP_PER_HOUSE = 4;
export const START_SETTLERS = 5;
export const START_STOCK: Partial<Record<ResourceKind, number>> = { wood: 40, stone: 10, planks: 10, food: 30 };

/**
 * Їжа й голод. Ситість 0..FULL_MAX спадає на 1 кожні HUNGER_INTERVAL тіків (з повної до EAT_BELOW ≈ 600 тіків).
 * Нижче EAT_BELOW NPC між діями йде до найближчого складу з їжею й з'їдає 1 од. (+FOOD_RESTORE).
 * Нижче HUNGRY_BELOW працює повільніше (HUNGRY_MULT); на 0 без їжі не працює (фермер лише сповільнюється, щоб не було глухого кута).
 */
export const FULL_MAX = 100, HUNGER_INTERVAL = 12, EAT_BELOW = 50, HUNGRY_BELOW = 30, FOOD_RESTORE = 50, HUNGRY_MULT = 0.5;
