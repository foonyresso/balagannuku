import { describe, expect, it } from 'vitest';
import {
  CYCLE_TICKS, DAY_TICKS, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_KEYS, FIRST_NIGHT_TICK, ITEMS, NIGHT_TICKS, NPC_CLASSES, NPC_STATS, NPC_STAT_BASE,
  PERKS, PERK_SLOT_COUNT, PERK_SLOT_TIER, PROFESSIONS, RESOURCE_KINDS, TWILIGHT_TICKS, dayClock, itemDef, itemId, nightStartTick,
  npcPerks, packPerk, perkSlotsFromMask, perkValue, shiftForNightStart, shiftToNextDusk,
} from './index';

describe('годинник дня й ночі', () => {
  it('цикл: перша ніч через 15 хв, ніч 7 хв, день 10 хв', () => {
    expect(CYCLE_TICKS).toBe(DAY_TICKS + NIGHT_TICKS);
    expect(nightStartTick(1)).toBe(FIRST_NIGHT_TICK);
    expect(nightStartTick(2)).toBe(FIRST_NIGHT_TICK + CYCLE_TICKS);
    expect(dayClock(0).phase).toBe('day');
    expect(dayClock(FIRST_NIGHT_TICK - TWILIGHT_TICKS - 1)).toMatchObject({ phase: 'day', night: 1, light: 1 });
    expect(dayClock(FIRST_NIGHT_TICK - TWILIGHT_TICKS).phase).toBe('dusk');
    expect(dayClock(FIRST_NIGHT_TICK)).toMatchObject({ phase: 'night', night: 1, light: 0, ticksToNight: 0, ticksToDay: NIGHT_TICKS });
    expect(dayClock(FIRST_NIGHT_TICK + NIGHT_TICKS - TWILIGHT_TICKS).phase).toBe('dawn');
    expect(dayClock(FIRST_NIGHT_TICK + NIGHT_TICKS)).toMatchObject({ phase: 'day', night: 2 });
    expect(dayClock(nightStartTick(5) + 10)).toMatchObject({ phase: 'night', night: 5 });
  });

  it('освітленість плавно змінюється на сутінках і світанку', () => {
    expect(dayClock(FIRST_NIGHT_TICK - TWILIGHT_TICKS / 2).light).toBeCloseTo(0.5);
    expect(dayClock(FIRST_NIGHT_TICK + NIGHT_TICKS - TWILIGHT_TICKS / 2).light).toBeCloseTo(0.5);
  });

  it('зсув: старт будь-якої ночі й скіп дня не чіпають tick', () => {
    for (const tick of [0, 1234, 20000]) {
      for (const n of [1, 3, 10]) expect(dayClock(tick, shiftForNightStart(tick, n))).toMatchObject({ phase: 'night', night: n, ticksToDay: NIGHT_TICKS });
      const sh = shiftToNextDusk(tick, 0);
      expect(dayClock(tick, sh).phase).toBe('dusk');
      expect(shiftToNextDusk(tick, sh)).toBe(sh); // уже сутінки
    }
    // З ночі: сутінки наступної
    const inNight = FIRST_NIGHT_TICK + 100;
    expect(dayClock(inNight, shiftToNextDusk(inNight, 0))).toMatchObject({ phase: 'dusk', night: 2 });
    // від'ємний годинник не падає
    expect(dayClock(10, -100000).phase).toBe('day');
  });
});

describe('перки: слоти', () => {
  it('упаковка слота й значення з кидка', () => {
    const s = packPerk(2, 200);
    expect(s >> 8).toBe(3);
    const sl = new Uint16Array(PERK_SLOT_COUNT * 2);
    sl[PERK_SLOT_COUNT] = s; sl[PERK_SLOT_COUNT + 3] = packPerk(4, 0);
    const ps = npcPerks(sl, 1);
    expect(ps.map((p) => [p.def.key, p.slot, p.roll])).toEqual([['woodcutter', 0, 200], ['lucky', 3, 0]]);
    expect(npcPerks(sl, 0)).toEqual([]);
    expect(perkValue(0, 10, 30)).toBe(10);
    expect(perkValue(255, 10, 30)).toBe(30);
  });

  it('маска старого формату: звичайні в слоти 1–3, lucky у рідкісний', () => {
    const slots = perkSlotsFromMask(0b10101); // swift, woodcutter, lucky
    expect(slots.map((v) => (v ? PERKS[(v >> 8) - 1].key : null))).toEqual(['swift', 'woodcutter', null, 'lucky', null]);
    expect(perkSlotsFromMask(0)).toEqual([0, 0, 0, 0, 0]);
    expect(perkSlotsFromMask(0b01111).filter(Boolean).length).toBe(3); // четвертий звичайний губиться
  });

  it('таблиця перків узгоджена зі слотами', () => {
    expect(new Set(PERKS.map((p) => p.key)).size).toBe(PERKS.length);
    expect(PERK_SLOT_TIER).toHaveLength(PERK_SLOT_COUNT);
    for (const p of PERKS) if (p.tier === 'common') expect(p.scope).not.toBe('general'); // звичайні лише класові
    expect(PERKS.length).toBeLessThan(255);
  });
});

describe('контракти NPC і предметів', () => {
  it('стати: база для кожної, нові лише в кінець', () => {
    expect(NPC_STAT_BASE).toHaveLength(NPC_STATS.length);
    expect(NPC_STATS.slice(0, 5)).toEqual(['walk', 'carry', 'gather', 'rare', 'size']);
    expect(NPC_STATS.slice(5)).toEqual(['hp', 'atk', 'def', 'mana', 'appetite']);
  });

  it('порядок видів і професій у кінці: старі індекси не зсунуті', () => {
    expect(RESOURCE_KINDS.slice(0, 7)).toEqual(['wood', 'stone', 'ore', 'water', 'food', 'planks', 'gold']);
    expect(PROFESSIONS.slice(0, 10)).toEqual(['idle', 'lumberjack', 'miner', 'carrier', 'smith', 'hero', 'sawyer', 'farmer', 'hunter', 'fisher']);
    expect(PROFESSIONS).toContain('builder');
    expect(NPC_CLASSES[0]).toBe('none');
  });

  it('6 слотів спорядження; предмети мають унікальні ключі й коректний слот', () => {
    expect(EQUIPMENT_SLOTS).toBe(6);
    expect(new Set(ITEMS.map((i) => i.key)).size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      expect(EQUIPMENT_SLOT_KEYS).toContain(it.slot);
      expect(it.classes.length).toBeGreaterThan(0);
    }
    const bow = itemId('short_bow');
    expect(bow).toBeGreaterThan(0);
    expect(itemDef(bow)?.twoHanded).toBe(true);
    expect(itemDef(0)).toBeUndefined();
  });
});
