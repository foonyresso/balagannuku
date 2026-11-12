/** Ідентичність і характеристики NPC (структура під майбутні імена, стати й перки; поки лише базові множники). */

/**
 * Стати в відсотках (100 = норма), окрім rare — шанс рідкісного ресурсу у проміле. Масив stats: capacity * NPC_STAT_COUNT.
 * Нові стати лише в кінець (stride статів змінюється: deserialize переносить старі й дописує норму).
 * hp, atk, def, mana — множники до бази класу; appetite — споживання їжі. Максимуми виводяться: база класу × рівень × стат × перки.
 */
export const NPC_STATS = ['walk', 'carry', 'gather', 'rare', 'size', 'hp', 'atk', 'def', 'mana', 'appetite'] as const;
export type NpcStat = (typeof NPC_STATS)[number];
export const NPC_STAT_COUNT = NPC_STATS.length;
export const NPC_STAT_BASE: readonly number[] = [100, 100, 100, 0, 2, 100, 100, 100, 100, 100]; // size — ширина в тайлах: 1 малий (пролазить у прохід 1 тайл), 2 стандартний
export const statIndex = (s: NpcStat): number => NPC_STATS.indexOf(s);

/** Бойовий клас (NpcStore.klass, індекс). none — ремісник або кандидат без класу. Нові лише в кінець. */
export const NPC_CLASSES = ['none', 'swordsman', 'archer', 'mage'] as const;
export type NpcClass = (typeof NPC_CLASSES)[number];
export const classIndex = (c: NpcClass): number => NPC_CLASSES.indexOf(c);

export const MAX_NPC_LEVEL = 20;
/** Настрій 0..100 (NpcStore.mood); новий NPC стартує з нейтрального. Дуже низький: іде з міста. */
export const MOOD_START = 50;
/** З чого складається настрій (потреби); ваги й пороги в `sim/balance/`. */
export const MOOD_FACTORS = ['fullness', 'housing', 'safety', 'shop', 'food'] as const;
export type MoodFactor = (typeof MOOD_FACTORS)[number];

/** Баф від страви (NpcStore.buff, id; 0 = нема). Діє до buffUntil (тік). Таблиця бафів приходить із ремеслами. */
export const NO_BUFF = 0;

const FIRST = ['Андрій', 'Богдан', 'Василь', 'Григорій', 'Данило', 'Іван', 'Кирило', 'Левко', 'Михайло', 'Назар', 'Олег', 'Петро', 'Роман', 'Степан', 'Тарас', 'Юрко',
  'Анна', 'Берта', 'Валя', 'Галя', 'Дарина', 'Єва', 'Зоя', 'Ірина', 'Катря', 'Леся', 'Марта', 'Нінель', 'Оксана', 'Поліна', 'Роксана', 'Устина'];
const LAST = ['Балагула', 'Вовк', 'Гончар', 'Дуб', 'Жук', 'Коваль', 'Лис', 'Мельник', 'Онищук', 'Пасічник', 'Сірко', 'Ткач', 'Хмара', 'Цибуля', 'Чорний', 'Шевчук'];

/** Ім'я за nameId (u16: індекс імені × 16 + прізвища). */
export const npcName = (nameId: number): string => `${FIRST[(nameId >> 4) % FIRST.length]} ${LAST[nameId % LAST.length]}`;
/** nameId з хешу (0..1): ім'я (32) і прізвище (16). */
export const makeNameId = (h: number): number => (Math.floor(h * 32) << 4) | Math.floor(((h * 977) % 1) * 16);
