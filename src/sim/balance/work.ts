/** Праця й логістика: тривалості дій (у тіках), ноша, буфери. */

export const CARRY_CAP = 3; // колод/каменів за один рейс (по одному за візит до вузла)
export const PROCESS_TICKS = 30; // обтесування в хатинці (лісоруб/каменяр) перед доставкою
export const WORK_TICKS = 15; // добування одиниці
export const MILL_TICKS = 20; // 2 дерева -> 1 дошка
export const WAIT_TICKS = 15; // очікування при нестачі
/** Радіус пошуку вузла від будівлі (клітинок). За замовчуванням — увесь сектор: відстань не заважає роботі. */
export const WORK_RADIUS = 64; // у клітинках навігації
export const ATTACHED_WORK_MULT = 0.8; // будівля на дорозі працює швидше
export const MILL_BUFFER = 15; // буфер колод лісопильні
/** Ноша носія підскладу за рейс (більша за звичайну). */
export const CARRIER_CAP = 12;
/** Резерв дерева на складах: переробка (лісопильня) не бере й не приймає дерево, поки на складах менше. Будівництво важливіше. */
export const WOOD_RESERVE = 10;
/** Ферма: одна од. їжі за FARM_TICKS роботи, фермер несе до FARM_CARRY за рейс. */
export const FARM_TICKS = 150, FARM_CARRY = 4;
/** Рибалка: ставиться на березі (вхід не далі FISH_SHORE_RADIUS тайлів від води), 1 од. їжі за FISH_TICKS. */
export const FISH_TICKS = 120, FISH_SHORE_RADIUS = 12;
