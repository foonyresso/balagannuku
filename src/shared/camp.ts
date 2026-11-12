/**
 * Вогнище для вільних жителів (контракт sim ↔ render). Не серіалізується: позиція виводиться з ратуші.
 *
 * Правила:
 *  - Вогнище стоїть перед ратушею на відстані CAMP_OFFSET тайлів від її переднього краю (≈ розмір ратуші).
 *  - Вільні жителі (без роботи) гравця: мінімум CAMP_MIN_SLOTS стоять біля вогнища (якщо вільних стільки є;
 *    менше вільних — стоять усі; жодного — нікого). Слоти фіксовані й розставлені колом (campSlotSpot).
 *  - Решта вільних бродить у радіусі ROAM_RADIUS тайлів від входу найближчої споруди й не розходиться далеко.
 *  - Коли слот звільняється (жителя взяли на роботу), його займає найближчий вільний.
 *  - Навколо вогнища (CAMP_PLAZA тайлів) забудова заборонена.
 */
export const CAMP_MIN_SLOTS = 5;
/** Відстань від переднього краю ратуші до вогнища, тайлів (ратуша 20×20). */
export const CAMP_OFFSET = 20;
/** Напіврозмір зони навколо вогнища, де не будують (тайлів). */
export const CAMP_PLAZA = 8;
/** Радіус кола слотів навколо вогнища (тайлів). */
export const CAMP_RING = 5;
/** Радіус бродіння навколо входу найближчої споруди (тайлів). */
export const ROAM_RADIUS = 14;
/** Раз на скільки тіків перерозподіляємо слоти вогнища. */
export const CAMP_REBALANCE_TICKS = 5;

/** Розмір спрайта вогнища, тайлів (лише вигляд; забудова заборонена в CAMP_PLAZA). */
export const CAMP_TILES = 3;

export interface Campfire { x: number; y: number }

/** Точка слота k (0..CAMP_MIN_SLOTS-1) навколо вогнища: коло радіусом CAMP_RING, кут стабільний. */
export function campSlotSpot(fire: Campfire, slot: number): { x: number; y: number } {
  const a = (slot / CAMP_MIN_SLOTS) * Math.PI * 2 + 0.6;
  return { x: fire.x + Math.cos(a) * CAMP_RING, y: fire.y + Math.sin(a) * CAMP_RING * 0.8 };
}

/** Скільки слотів зайнято при `free` вільних жителях. */
export const campOccupied = (free: number): number => Math.min(free, CAMP_MIN_SLOTS);
