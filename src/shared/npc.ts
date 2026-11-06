/** Ідентичність і характеристики NPC (структура під майбутні імена, стати й перки; поки лише базові множники). */

/** Стати в відсотках (100 = норма), окрім rare — шанс рідкісного ресурсу у проміле. Масив stats: capacity * NPC_STAT_COUNT. */
export const NPC_STATS = ['walk', 'carry', 'gather', 'rare', 'size'] as const;
export type NpcStat = (typeof NPC_STATS)[number];
export const NPC_STAT_COUNT = NPC_STATS.length;
export const NPC_STAT_BASE: readonly number[] = [100, 100, 100, 0, 2]; // size — ширина в тайлах: 1 малий (пролазить у прохід 1 тайл), 2 стандартний
export const statIndex = (s: NpcStat): number => NPC_STATS.indexOf(s);

/** Перки — біти маски NpcStore.perks (поки без ефекту, крім заготовки під множники). */
export const PERKS = ['swift', 'porter', 'woodcutter', 'stonecutter', 'lucky'] as const;
export type Perk = (typeof PERKS)[number];
export const hasPerk = (mask: number, p: Perk): boolean => (mask & (1 << PERKS.indexOf(p))) !== 0;

const FIRST = ['Андрій', 'Богдан', 'Василь', 'Григорій', 'Данило', 'Іван', 'Кирило', 'Левко', 'Михайло', 'Назар', 'Олег', 'Петро', 'Роман', 'Степан', 'Тарас', 'Юрко',
  'Анна', 'Берта', 'Валя', 'Галя', 'Дарина', 'Єва', 'Зоя', 'Ірина', 'Катря', 'Леся', 'Марта', 'Нінель', 'Оксана', 'Поліна', 'Роксана', 'Устина'];
const LAST = ['Балагула', 'Вовк', 'Гончар', 'Дуб', 'Жук', 'Коваль', 'Лис', 'Мельник', 'Онищук', 'Пасічник', 'Сірко', 'Ткач', 'Хмара', 'Цибуля', 'Чорний', 'Шевчук'];

/** Ім'я за nameId (u16: індекс імені × 16 + прізвища). */
export const npcName = (nameId: number): string => `${FIRST[(nameId >> 4) % FIRST.length]} ${LAST[nameId % LAST.length]}`;
/** nameId з хешу (0..1): ім'я (32) і прізвище (16). */
export const makeNameId = (h: number): number => (Math.floor(h * 32) << 4) | Math.floor(((h * 977) % 1) * 16);
