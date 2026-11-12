/**
 * Перки NPC. У сейві: `NpcStore.perkSlots`, на NPC `PERK_SLOT_COUNT` слотів u16 = `perkId << 8 | roll`.
 * perkId = індекс у `PERKS` + 1 (0 = порожньо). `roll` 0..255 лінійно переводиться в діапазон [min, max] перка.
 * Діапазони й ефекти лежать у `sim/balance/perks.ts`, тут лише ідентичність (ключ, клас, градація). Нові перки лише в кінець.
 */
import type { Profession } from './ids';
import type { NpcClass } from './npc';

export const PERK_SLOT_COUNT = 5;
export type PerkTier = 'common' | 'rare' | 'unique';
/** Слот 1–3 звичайні, 4 рідкісний, 5 унікальний. */
export const PERK_SLOT_TIER: readonly PerkTier[] = ['common', 'common', 'common', 'rare', 'unique'];
/** Кому належить перк: професії (ремесло), бойовому класу або всім. Звичайні перки лише класові. */
export type PerkScope = Profession | NpcClass | 'general';

export interface PerkDef {
  key: string;
  scope: PerkScope;
  tier: PerkTier;
}

export const PERKS: readonly PerkDef[] = [
  { key: 'swift', scope: 'carrier', tier: 'common' },
  { key: 'porter', scope: 'carrier', tier: 'common' },
  { key: 'woodcutter', scope: 'lumberjack', tier: 'common' },
  { key: 'stonecutter', scope: 'miner', tier: 'common' },
  { key: 'lucky', scope: 'general', tier: 'rare' },
];

export const packPerk = (perkIndex: number, roll: number): number => ((perkIndex + 1) << 8) | (roll & 255);
/** Індекс у PERKS або -1, якщо слот порожній. */
export const perkIndexOf = (slot: number): number => (slot >> 8) - 1;
export const perkRollOf = (slot: number): number => slot & 255;
/** Значення перка з кидка: roll 0..255 -> [min, max]. */
export const perkValue = (roll: number, min: number, max: number): number => min + ((max - min) * roll) / 255;

export interface NpcPerk { def: PerkDef; index: number; slot: number; roll: number }

/** Перки NPC `id` зі сховища perkSlots (порожні слоти пропущено). */
export function npcPerks(perkSlots: ArrayLike<number>, id: number): NpcPerk[] {
  const out: NpcPerk[] = [];
  for (let s = 0; s < PERK_SLOT_COUNT; s++) {
    const v = perkSlots[id * PERK_SLOT_COUNT + s];
    const index = perkIndexOf(v);
    if (index >= 0 && index < PERKS.length) out.push({ def: PERKS[index], index, slot: s, roll: perkRollOf(v) });
  }
  return out;
}

/** Старий формат (до сейва v10): біти маски в порядку swift, porter, woodcutter, stonecutter, lucky. */
const LEGACY_MASK_ORDER = ['swift', 'porter', 'woodcutter', 'stonecutter', 'lucky'] as const;
const LEGACY_ROLL = 128; // серединне значення діапазону

/**
 * Перенос маски в слоти: звичайні в слоти 1–3 за порядком, `lucky` у рідкісний слот 4.
 * Звичайних у масці може бути 4, а слотів 3: четвертий губиться (у грі маску ніхто не виставляв).
 */
export function perkSlotsFromMask(mask: number): number[] {
  const slots = new Array<number>(PERK_SLOT_COUNT).fill(0);
  let common = 0;
  LEGACY_MASK_ORDER.forEach((key, bit) => {
    if (!(mask & (1 << bit))) return;
    const index = PERKS.findIndex((p) => p.key === key);
    if (PERKS[index].tier === 'common') { if (common < 3) slots[common++] = packPerk(index, LEGACY_ROLL); }
    else slots[3] = packPerk(index, LEGACY_ROLL);
  });
  return slots;
}
