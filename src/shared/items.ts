/**
 * Предмети й слоти спорядження. Предмет = запис у `ITEMS` (фіксовані стати, без афіксів); id = індекс + 1, 0 = порожньо.
 * Лежить у `NpcStore.inventory` (INVENTORY_SLOTS) і `NpcStore.equipment` (EQUIPMENT_SLOTS) як u16. Нові предмети лише в кінець.
 * Числа статів тут стартові, остаточний баланс — у `sim/balance/`, коли дійдемо до ремесел.
 */
import type { ItemId } from './ids';
import type { NpcClass } from './npc';

/** Порядок = індекс слота в `NpcStore.equipment`. Дворучна зброя займає ще й `offhand`. */
export const EQUIPMENT_SLOT_KEYS = ['weapon', 'offhand', 'armor', 'boots', 'neck', 'hands'] as const;
export type EquipSlot = (typeof EQUIPMENT_SLOT_KEYS)[number];
export const EQUIPMENT_SLOTS = EQUIPMENT_SLOT_KEYS.length; // 6 (було 4)
export const equipSlotIndex = (s: EquipSlot): number => EQUIPMENT_SLOT_KEYS.indexOf(s);

export interface ItemDef {
  key: string;
  slot: EquipSlot;
  twoHanded: boolean;
  /** Які класи можуть носити. */
  classes: readonly NpcClass[];
  tier: number;
  /** Бонуси до бойових статів (абсолютні числа). */
  bonus: { hp?: number; mana?: number; atk?: number; def?: number };
}

const ALL: readonly NpcClass[] = ['swordsman', 'archer', 'mage'];

export const ITEMS: readonly ItemDef[] = [
  { key: 'wood_sword', slot: 'weapon', twoHanded: false, classes: ['swordsman'], tier: 1, bonus: { atk: 3 } },
  { key: 'short_bow', slot: 'weapon', twoHanded: true, classes: ['archer'], tier: 1, bonus: { atk: 3 } },
  { key: 'apprentice_staff', slot: 'weapon', twoHanded: true, classes: ['mage'], tier: 1, bonus: { atk: 4, mana: 10 } },
  { key: 'wood_shield', slot: 'offhand', twoHanded: false, classes: ['swordsman'], tier: 1, bonus: { def: 2 } },
  { key: 'leather_armor', slot: 'armor', twoHanded: false, classes: ALL, tier: 1, bonus: { def: 2, hp: 10 } },
];

export const itemDef = (id: ItemId): ItemDef | undefined => ITEMS[id - 1];
export const itemId = (key: string): ItemId => ITEMS.findIndex((i) => i.key === key) + 1; // 0, якщо не знайдено
